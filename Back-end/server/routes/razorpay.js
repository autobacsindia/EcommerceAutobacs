import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { validateRazorpayOrder, validateRazorpayVerification } from "../middleware/validationMiddleware.js";
import razorpayService from "../services/razorpayService.js";
import orderRepository from "../repositories/orderRepository.js";
import { paymentSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";
import crypto from 'crypto';
import { getRedisClient } from '../services/cache/redisClient.js';
import csrfProtection from '../middleware/csrfMiddleware.js';
import rateLimit from 'express-rate-limit';
import { buildCookieOptions } from '../utils/cookieOptions.js';

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

// RATE LIMITING: /create-order - Identity-based (prevent API quota exhaustion)
const createOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // 15 orders per identity per 10 min
  keyGenerator: (req) => {
    // Identity-based: user > guest session > order ID > IP
    return (
      req.user?.id ||
      req.cookies.guest_session ||
      `ip:${req.ip || 'unknown'}`
    );
  },
  message: {
    success: false,
    message: 'Too many orders created. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// RATE LIMITING: /verify-payment - Identity-based (prevent spam)
const verifyIPRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per identity per 15 min
  keyGenerator: (req) => {
    // Identity-based: user > guest session > IP
    return (
      req.user?.id ||
      req.cookies.guest_session ||
      `ip:${req.ip || 'unknown'}`
    );
  },
  message: {
    success: false,
    message: 'Too many verification attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// RATE LIMITING: /verify-payment - Per-order-ID (prevent brute force)
const verifyOrderRateLimit = rateLimit({
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
// SECURITY: Rate limited to prevent API quota exhaustion
router.post("/create-order", optionalAuth, createOrderLimiter, validateRazorpayOrder, asyncHandler(async (req, res) => {
  try {
    const { orderId, currency, receipt } = req.body;
    
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const clientSessionId = req.headers['x-session-id'] || req.sessionID;
    
    // Verify the order exists and belongs to user/session.
    // Primary: match by authenticated user ID.
    // Fallback: match by session ID (guests, or if token expired mid-checkout).
    let order;
    if (isAuthenticated) {
      order = await orderRepository.findOne({ _id: orderId, user: req.user.id });
    }
    if (!order && clientSessionId) {
      order = await orderRepository.findOne({ _id: orderId, sessionId: clientSessionId });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or does not belong to user/session'
      });
    }
    
    // SECURITY: amount is always taken from the DB order, never from the request body.
    // The browser is user-controlled territory — any client-supplied amount is ignored.
    const authorativeAmount = Math.round(order.totalAmount * 100); // convert ₹ → paise

    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder({
      orderId,
      amount: authorativeAmount,
      currency,
      receipt
    });
    
    // SECURITY: Bind guest order to server-generated session (prevents hijacking)
    if (!isAuthenticated) {
      // Generate secure session token (256-bit entropy)
      const serverSessionToken = crypto.randomBytes(32).toString('hex');

      // Store in Redis: razorpayOrderId -> serverSessionToken (30 min expiry)
      // NOTE: getRedisClient() returns the app-wide ioredis singleton — never quit() it
      // from a request handler; that tears down Redis for every other request.
      const redisClient = getRedisClient();
      try {
        // REDIS KEY VALIDATION: Prevent namespace exhaustion attacks
        if (!razorpayOrder.orderId || !razorpayOrder.orderId.startsWith('order_')) {
          console.error('[SECURITY] Invalid Razorpay order ID format:', razorpayOrder.orderId);
          return res.status(400).json({
            success: false,
            message: 'Invalid order ID format'
          });
        }
        
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
        
        await orderRepository.save(order);

        // Send session token as httpOnly cookie (scoped to payment routes).
        // secure/sameSite/domain follow env (cookieOptions) for domain portability;
        // path stays tightened to the payment routes.
        res.cookie('guest_session', serverSessionToken, buildCookieOptions({
          httpOnly: true,
          path: '/api/v1/razorpay',  // Tightened scope
          maxAge: 30 * 60 * 1000 // 30 minutes
        }));
        
      } catch (redisError) {
        console.error('[SECURITY] Redis unavailable for session binding:', redisError.message);
        // FAIL-CLOSED: Don't create order without session binding
        return res.status(503).json({
          success: false,
          message: 'Session verification unavailable. Please try again.'
        });
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
// SECURITY: Rate limiting + CSRF protection required
router.post("/verify-payment",
  optionalAuth,            // Populate req.user for authenticated users
  verifyIPRateLimit,       // Per-IP rate limit (50 req/15min)
  verifyOrderRateLimit,    // Per-order-ID rate limit (10 req/15min)
  csrfProtection,          // CSRF token validation
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
      order = await orderRepository.findById(orderId);
    } else {
      // Fallback: try to find by gatewayOrderId (will likely fail if Payment record doesn't exist yet)
      order = await orderRepository.findOne({ 'payment.gatewayOrderId': razorpay_order_id });
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
      const redisClient = getRedisClient();
      try {
        // REDIS KEY VALIDATION: Prevent namespace exhaustion attacks
        if (!razorpay_order_id || !razorpay_order_id.startsWith('order_')) {
          console.error('[SECURITY] Invalid Razorpay order ID format:', razorpay_order_id);
          return res.status(400).json({
            success: false,
            message: 'Invalid order ID format'
          });
        }
        
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
              await orderRepository.save(order);
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
          await orderRepository.save(order);
          
          // FAIL-CLOSED: Don't allow without any binding
          return res.status(503).json({
            success: false,
            message: 'Session verification unavailable. Please try again.'
          });
        }
        
        // Verify against DB hash
        console.warn('[SECURITY] Using DB fallback for session validation');
        const cookieSessionToken = req.cookies.guest_session;
        
        if (!cookieSessionToken) {
          return res.status(403).json({ message: 'Session validation failed' });
        }
        
        const clientHash = crypto.createHash('sha256').update(cookieSessionToken).digest('hex');
        if (clientHash !== order.guestSessionHash) {
          return res.status(403).json({ message: 'Session validation failed' });
        }
        
      }
    }

    // Note: Idempotency check already done at line 159 (handles webhook race + retries)
    
    // PAYMENT AUTHORITY: Webhook is sole authority for payment confirmation
    // Client endpoint validates signature + session, but DOES NOT update DB
    // This eliminates race complexity and dual-writer issues
    
    // SESSION ROTATION: Invalidate session after successful validation (one-time use)
    if (!isAuthenticated) {
      try {
        const redisClient = getRedisClient();

        // Delete Redis session (one-time token)
        if (redisClient) await redisClient.del(`guest_order:v1:${razorpay_order_id}`);

        // Clear cookie
        res.clearCookie('guest_session', { path: '/api/v1/razorpay' });
      } catch (error) {
        console.warn('[SECURITY] Failed to rotate session token:', error.message);
        // Non-critical - continue
      }
    }
    
    // Return pending status - UI should poll /order-status or use WebSocket
    // Webhook will update order status to 'completed' asynchronously
    res.json({
      success: true,
      message: 'Payment signature verified. Awaiting webhook confirmation.',
      data: {
        orderId: order._id,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        status: 'pending_webhook',
        note: 'Order will be confirmed once Razorpay webhook is received'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

export default router;