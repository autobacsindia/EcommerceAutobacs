import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validateRazorpayOrder, validateRazorpayVerification } from "../middleware/validationMiddleware.js";
import razorpayService from "../services/razorpayService.js";
import Order from "../models/Order.js";
import { paymentSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";
import crypto from 'crypto';
import Redis from 'ioredis';
import csrfProtection from '../middleware/csrfMiddleware.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

/**
 * Normalize client IP for accurate logging (handles CDNs, proxies, NAT)
 * @param {Request} req - Express request object
 * @returns {string} Normalized client IP
 */
function getClientIP(req) {
  // Prefer x-forwarded-for (CDN/proxy header)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // First IP in chain is original client
    return forwarded.split(',')[0].trim();
  }
  
  // Fallback to req.ip (may be proxy IP)
  return req.ip || req.connection.remoteAddress || 'unknown';
}

/**
 * Get normalized User-Agent
 * @param {Request} req - Express request object
 * @returns {string} User-Agent string
 */
function getUserAgent(req) {
  return req.get('user-agent') || 'unknown';
}

// RATE LIMITING: Per-IP rate limiter (prevent spam/DoS)
const ipRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per 15 min
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// RATE LIMITING: Per-order-ID rate limiter (prevent order enumeration spam)
const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per order ID per 15 min
  keyGenerator: (req) => `verify:${req.body.razorpay_order_id || 'unknown'}`,
  message: {
    success: false,
    message: 'Too many verification attempts for this order'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply session keep-alive and token refresh middleware to all payment routes
router.use(paymentSessionKeepAlive);
router.use(attachTokenRefreshInfo);

// @route   POST /razorpay/create-order
// @desc    Create a Razorpay order with session binding (SECURED)
// @access  Private (or guest with session)
router.post("/create-order", validateRazorpayOrder, asyncHandler(async (req, res) => {
  try {
    const { orderId, amount, currency, receipt } = req.body;
    
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const clientSessionId = req.headers['x-session-id'] || req.sessionID;
    
    // Verify the order exists and belongs to user/session
    let order;
    if (isAuthenticated) {
      order = await Order.findOne({ _id: orderId, user: req.user.id });
    } else {
      if (!clientSessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required for guest operations'
        });
      }
      order = await Order.findOne({ _id: orderId, sessionId: clientSessionId });
    }
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or does not belong to user/session'
      });
    }
    
    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder({
      orderId,
      amount,
      currency,
      receipt
    });
    
    // SECURITY: Bind guest order to server-generated session (prevents hijacking)
    if (!isAuthenticated) {
      const Redis = await import('ioredis');
      const crypto = await import('crypto');
      
      // Generate secure session token (256-bit entropy)
      const serverSessionToken = crypto.randomBytes(32).toString('hex');
      
      // Store in Redis: razorpayOrderId -> serverSessionToken (30 min expiry)
      let redisClient = null;
      try {
        redisClient = new Redis.default(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
        });
        
        await redisClient.set(
          `guest_order:v1:${razorpayOrder.orderId}`,  // Versioned namespace
          serverSessionToken,
          'EX',
          30 * 60 // 30 minutes
        );
        
        // Store hash in DB (defense-in-depth, survives Redis outage)
        const sessionHash = crypto.createHash('sha256').update(serverSessionToken).digest('hex');
        order.guestSessionHash = sessionHash;
        order.sessionCreatedAt = new Date();
        
        // Store normalized IP/UA hashes for forensic visibility
        const clientIP = getClientIP(req);
        const clientUA = getUserAgent(req);
        order.guestIPHash = crypto.createHash('sha256').update(clientIP).digest('hex');
        order.guestUAHash = crypto.createHash('sha256').update(clientUA).digest('hex');
        
        await order.save();
        
        // Send session token as httpOnly cookie (scoped to payment routes)
        res.cookie('guest_session', serverSessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/api/v1/razorpay',  // Tightened scope
          maxAge: 30 * 60 * 1000 // 30 minutes
        });
        
      } catch (redisError) {
        console.error('[SECURITY] Redis unavailable for session binding:', redisError.message);
        // FAIL-CLOSED: Don't create order without session binding
        return res.status(503).json({
          success: false,
          message: 'Session verification unavailable. Please try again.'
        });
      } finally {
        if (redisClient) {
          redisClient.quit().catch(() => {});
        }
      }
    }
    
    res.json({
      success: true,
      data: razorpayOrder
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

// @route   POST /razorpay/verify-payment
// @desc    Verify Razorpay payment and update order status (supports both authenticated and guest users)
// @access  Public (optional auth)
// SECURITY: CSRF protection + Rate limiting required
router.post("/verify-payment", 
  ipRateLimit,           // Per-IP rate limit (100 req/15min)
  orderRateLimit,        // Per-order-ID rate limit (10 req/15min)
  csrfProtection,        // CSRF token validation
  validateRazorpayVerification, 
  asyncHandler(async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    
    // Verify payment signature
    const verificationResult = await razorpayService.verifyPayment({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    });
    
    if (!verificationResult.success || !verificationResult.verified) {
      return res.status(400).json({
        success: false,
        message: verificationResult.message || 'Payment verification failed'
      });
    }
    
    // Find order
    let order;
    if (orderId) {
      order = await Order.findById(orderId);
    } else {
      // Fallback: try to find by gatewayOrderId (will likely fail if Payment record doesn't exist yet)
      order = await Order.findOne({ 'payment.gatewayOrderId': razorpay_order_id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // IDEMPOTENCY: Check if order already completed (handles retries after session rotation)
    if (order.payment && order.payment.status === 'completed') {
      console.log(`[Payment] Payment already processed (retry) | Order: ${order._id}`);
      return res.status(200).json({
        success: true,
        message: 'Payment already processed'
      });
    }
    
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const clientSessionId = req.headers['x-session-id'] || req.sessionID;
    
    // SECURITY: Validate session binding for guest orders (prevents hijacking)
    if (!isAuthenticated) {
      if (!clientSessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required for guest operations'
        });
      }
      
      // Verify session binding in Redis
      let redisClient = null;
      try {
        const Redis = await import('ioredis');
        const crypto = await import('crypto');
        
        redisClient = new Redis.default(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
        });
        
        // Get server-stored session token for this Razorpay order
        const serverSessionToken = await redisClient.get(`guest_order:v1:${razorpay_order_id}`);  // Versioned namespace
        
        if (!serverSessionToken) {
          // FALLBACK: Check DB hash (defense-in-depth)
          if (!order.guestSessionHash) {
            console.error(
              `[SECURITY] Missing session binding for guest order | Razorpay Order: ${razorpay_order_id}`
            );
            // FAIL-CLOSED: Don't allow without binding
            return res.status(503).json({
              success: false,
              message: 'Session verification unavailable. Please try again.'
            });
          }
          
          // Verify against DB hash
          console.warn(
            `[SECURITY] Redis session expired, using DB fallback | Razorpay Order: ${razorpay_order_id}`
          );
          
          // Get client session from httpOnly cookie
          const cookieSessionToken = req.cookies.guest_session;
          
          if (!cookieSessionToken) {
            console.error('[SECURITY] No guest session cookie provided');
            return res.status(403).json({
              success: false,
              message: 'Session validation failed'
            });
          }
          
          // Hash client token and compare with DB
          const clientHash = crypto.createHash('sha256').update(cookieSessionToken).digest('hex');
          
          if (clientHash !== order.guestSessionHash) {
            console.error(
              `[SECURITY] Session mismatch for guest order | Razorpay Order: ${razorpay_order_id}`
            );
            return res.status(403).json({
              success: false,
              message: 'Session validation failed'
            });
          }
          
          // Check session expiry (30 min)
          if (order.sessionCreatedAt) {
            const sessionAge = Date.now() - new Date(order.sessionCreatedAt).getTime();
            if (sessionAge > 30 * 60 * 1000) {
              console.warn(
                `[SECURITY] Session expired during payment | Order: ${order._id} | Age: ${Math.round(sessionAge / 1000)}s`
              );
              // Mark with security flag but allow (don't reject legitimate delayed payments)
              if (!order.securityFlags) order.securityFlags = [];
              order.securityFlags.push('SESSION_EXPIRED_DURING_PAYMENT');
              await order.save();
            }
          }
          
        } else {
          // Redis available - use primary validation
          // Get client session from httpOnly cookie (NOT from request body)
          const cookieSessionToken = req.cookies.guest_session;
          
          if (!cookieSessionToken) {
            console.error('[SECURITY] No guest session cookie provided');
            return res.status(403).json({
              success: false,
              message: 'Session validation failed'
            });
          }
          
          // TIMING-SAFE comparison (prevent timing attacks)
          const isMatch = 
            cookieSessionToken.length === serverSessionToken.length &&
            crypto.timingSafeEqual(
              Buffer.from(cookieSessionToken),
              Buffer.from(serverSessionToken)
            );
          
          if (!isMatch) {
            console.error(
              `[SECURITY] Session mismatch for guest order | Razorpay Order: ${razorpay_order_id}`
            );
            return res.status(403).json({
              success: false,
              message: 'Session validation failed'
            });
          }
        }
        
      } catch (redisError) {
        console.error('[SECURITY] Redis unavailable for session validation:', redisError.message);
        
        // FALLBACK: Use DB hash verification
        if (!order.guestSessionHash) {
          console.error('[SECURITY] No session binding available (Redis + DB)');
          order.securityFlags = order.securityFlags || [];
          order.securityFlags.push('REDIS_UNAVAILABLE');
          await order.save();
          
          // FAIL-CLOSED: Don't allow without any binding
          return res.status(503).json({
            success: false,
            message: 'Session verification unavailable. Please try again.'
          });
        }
        
        // Verify against DB hash
        console.warn('[SECURITY] Using DB fallback for session validation');
        const crypto = await import('crypto');
        const cookieSessionToken = req.cookies.guest_session;
        
        if (!cookieSessionToken) {
          return res.status(403).json({ message: 'Session validation failed' });
        }
        
        const clientHash = crypto.createHash('sha256').update(cookieSessionToken).digest('hex');
        if (clientHash !== order.guestSessionHash) {
          return res.status(403).json({ message: 'Session validation failed' });
        }
        
      } finally {
        if (redisClient) {
          redisClient.quit().catch(() => {});
        }
      }
    }
    
    // Note: Idempotency check already done at line 159 (handles webhook race + retries)
    
    // Process successful payment
    const result = await razorpayService.processPaymentSuccess(
      order._id.toString(),
      verificationResult.payment,
      isAuthenticated ? req.user.id : null
    );
    
    // SESSION ROTATION: Invalidate session after successful verification (one-time use)
    if (!isAuthenticated) {
      try {
        const Redis = await import('ioredis');
        let redisClient = new Redis.default(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
        });
        
        // Delete Redis session (one-time token)
        await redisClient.del(`guest_order:v1:${razorpay_order_id}`);
        
        // Clear cookie
        res.clearCookie('guest_session', { path: '/api/v1/razorpay' });
        
        await redisClient.quit();
      } catch (error) {
        console.warn('[SECURITY] Failed to rotate session token:', error.message);
        // Non-critical - continue
      }
    }
    
    res.json({
      success: true,
      message: 'Payment verified and order updated',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

// @route   POST /razorpay/webhook
// @desc    Handle Razorpay webhook events (SECURED)
// @access  Public (secured by HMAC-SHA256 signature verification)
router.post("/webhook", express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  try {
    // SECURITY STEP 1: Verify HMAC-SHA256 signature
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (!signature) {
      console.error('[SECURITY] Razorpay webhook missing signature');
      return res.status(400).end();
    }
    
    if (!webhookSecret) {
      console.error('[CONFIG] RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(500).end();
    }
    
    // Compute expected signature using RAW body (Buffer, not JSON.stringify)
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body) // req.body is raw Buffer from express.raw()
      .digest('hex');
    
    // TIMING-SAFE comparison (prevents timing attacks)
    // IMPORTANT: Check length first to avoid timingSafeEqual crash
    if (
      !signature ||
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      )
    ) {
      console.error('[SECURITY] Invalid Razorpay webhook signature');
      return res.status(400).end();
    }
    
    // Parse webhook data (after signature verified)
    const webhookData = JSON.parse(req.body.toString());
    const eventId = webhookData.id;
    const eventType = webhookData.event;
    const createdAt = webhookData.created_at; // Unix timestamp
    
    // SECURITY STEP 2: Replay protection - Check event ID
    let redisClient = null;
    try {
      redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
      
      const eventExists = await redisClient.get(`razorpay:event:${eventId}`);
      if (eventExists) {
        console.log(`[Webhook] Duplicate event ignored: ${eventId}`);
        return res.status(200).end(); // Already processed
      }
      
      // Mark event as processed (24h TTL)
      await redisClient.set(`razorpay:event:${eventId}`, '1', 'EX', 86400);
    } catch (redisError) {
      console.warn('[Webhook] Redis unavailable, skipping replay protection:', redisError.message);
    } finally {
      if (redisClient) {
        redisClient.quit().catch(() => {});
      }
    }
    
    // SECURITY STEP 3: Timestamp validation (10-minute window with clock skew tolerance)
    const eventTime = createdAt * 1000; // Convert to milliseconds
    const now = Date.now();
    const tolerance = 10 * 60 * 1000; // 10 minutes
    
    // Reject future events (clock skew or manipulation)
    if (eventTime > now + tolerance) {
      console.error(
        `[SECURITY] Razorpay webhook from future | Event: ${eventId} | ` +
        `Event time: ${new Date(eventTime).toISOString()}`
      );
      return res.status(400).end();
    }
    
    // Warn on old events but allow if not seen before (replay protection handles this)
    if (now - eventTime > tolerance) {
      console.warn(
        `[SECURITY] Old Razorpay webhook | Event: ${eventId} | ` +
        `Age: ${Math.round((now - eventTime) / 1000)}s`
      );
      // Allow if event ID not seen before (already checked in Layer 2)
    }
    
    // SECURITY STEP 4: Validate event type (whitelist only)
    const allowedEvents = ['payment.captured', 'payment.failed', 'order.paid'];
    if (!allowedEvents.includes(eventType)) {
      console.log(`[Webhook] Ignoring unknown event type: ${eventType}`);
      return res.status(200).end(); // Safely ignore
    }
    
    // Process webhook event (with DB validation)
    const result = await razorpayService.handleWebhook(webhookData, eventType);
    
    res.status(200).json({
      success: true,
      message: result.message || 'Webhook processed successfully'
    });
    
  } catch (error) {
    console.error('[Webhook] Processing error:', error.message);
    res.status(500).end();
  }
}));

export default router;