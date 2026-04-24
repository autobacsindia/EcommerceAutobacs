import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validateRazorpayOrder, validateRazorpayVerification } from "../middleware/validationMiddleware.js";
import razorpayService from "../services/razorpayService.js";
import Order from "../models/Order.js";
import { paymentSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";
import crypto from 'crypto';
import Redis from 'ioredis';

const router = express.Router();

// Apply session keep-alive and token refresh middleware to all payment routes
router.use(paymentSessionKeepAlive);
router.use(attachTokenRefreshInfo);

// @route   POST /razorpay/create-order
// @desc    Create a Razorpay order
// @access  Private
router.post("/create-order", validateRazorpayOrder, asyncHandler(async (req, res) => {
  try {
    const { orderId, amount, currency, receipt } = req.body;
    
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const sessionId = req.headers['x-session-id'] || req.sessionID;
    
    // Verify the order exists and belongs to user/session
    let order;
    if (isAuthenticated) {
      order = await Order.findOne({ _id: orderId, user: req.user.id });
    } else {
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required for guest operations'
        });
      }
      order = await Order.findOne({ _id: orderId, sessionId });
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
router.post("/verify-payment", validateRazorpayVerification, asyncHandler(async (req, res) => {
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
    
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const sessionId = req.headers['x-session-id'] || req.sessionID;
    
    // Verify order belongs to user/session (skip for guest orders with sessionId)
    if (isAuthenticated && order.user && order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to verify this order'
      });
    } else if (!isAuthenticated && !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest operations'
      });
    }
    
    // Process successful payment
    const result = await razorpayService.processPaymentSuccess(
      order._id.toString(),
      verificationResult.payment,
      isAuthenticated ? req.user.id : null
    );
    
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