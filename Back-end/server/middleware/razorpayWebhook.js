/**
 * Razorpay Webhook Handler - Standalone Middleware
 * 
 * This handler MUST run before express.json() to preserve raw body for signature verification.
 * It's mounted directly in app.js before the global JSON parser.
 */

import express from 'express';
import crypto from 'crypto';
import Redis from 'ioredis';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import razorpayService from '../services/razorpayService.js';

const router = express.Router();

// @route   POST /razorpay/webhook
// @desc    Handle Razorpay webhook events (SECURED)
// @access  Public (secured by HMAC-SHA256 signature verification)
router.post("/", asyncHandler(async (req, res) => {
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
    const eventId = webhookData.id; // Razorpay event ID (not payment ID or order ID)
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
