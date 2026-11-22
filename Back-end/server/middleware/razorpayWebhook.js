/**
 * Razorpay Webhook Handler - Standalone Middleware
 * 
 * This handler MUST run before express.json() to preserve raw body for signature verification.
 * It's mounted directly in app.js before the global JSON parser.
 */

import express from 'express';
import crypto from 'crypto';
import { getRedisClient } from '../services/redisClient.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import razorpayService from '../services/razorpayService.js';
import WebhookEvent from '../models/WebhookEvent.js';
import { WEBHOOK_LAST_SEEN_KEY } from '../services/paymentReconciliationService.js';

const router = express.Router();

// ── Event claim (replay protection that survives a failed run) ────────────────
//
// claimed    → this delivery processes the event.
// duplicate  → a previous delivery finished it: answer 200, do nothing.
// in_flight  → another delivery is processing it right now: answer non-2xx so
//              Razorpay retries later (if that run fails, the retry must still run).
// unavailable→ neither store could record the claim: refuse (503) rather than risk
//              a double run. The Payment.gatewayPaymentId unique index is the hard
//              backstop for captures either way; the claim keeps duplicates cheap.
const EVENT_KEY_PREFIX = 'razorpay:event:';
const CLAIM_PROCESSING = 'processing';
const CLAIM_DONE = 'done';
const DONE_TTL_S = 24 * 60 * 60;
// A crashed process (deploy, OOM) cannot release its claim. Long enough to cover a
// slow run, short enough that one of Razorpay's later retries gets through.
const PROCESSING_TTL_S = 10 * 60;

export async function claimEvent(eventId, eventType) {
  const key = `${EVENT_KEY_PREFIX}${eventId}`;
  // The app-wide singleton — never quit() it here (PAY-1: that closed cache,
  // sessions and rate-limit for the whole process).
  const redis = getRedisClient();
  if (redis) {
    try {
      // SET NX is atomic: exactly one concurrent delivery wins the claim.
      const won = await redis.set(key, CLAIM_PROCESSING, 'EX', PROCESSING_TTL_S, 'NX');
      if (won) return { outcome: 'claimed', store: 'redis', key };
      const current = await redis.get(key);
      // null = the holder released/expired between our two calls; let Razorpay retry.
      if (current === CLAIM_PROCESSING || current === null) return { outcome: 'in_flight', store: 'redis' };
      // 'done', or the legacy '1' written before claims could be released.
      return { outcome: 'duplicate', store: 'redis' };
    } catch (redisError) {
      console.warn('[Webhook] Redis unavailable, falling back to MongoDB replay protection:', redisError.message);
    }
  }

  // MongoDB: insert is atomic on the unique eventId index.
  try {
    await WebhookEvent.create({ eventId, eventType, status: CLAIM_PROCESSING });
    return { outcome: 'claimed', store: 'mongo' };
  } catch (mongoError) {
    if (mongoError?.code !== 11000) {
      console.error('[Webhook] MongoDB replay protection unavailable:', mongoError?.message);
      return { outcome: 'unavailable', store: 'mongo' };
    }
    try {
      const existing = await WebhookEvent.findOne({ eventId }).lean();
      if (existing?.status === CLAIM_PROCESSING) {
        // A claim older than the processing window belongs to a run that died —
        // drop it so the NEXT retry can claim. This one still backs off.
        const age = Date.now() - new Date(existing.processedAt).getTime();
        if (age > PROCESSING_TTL_S * 1000) {
          await WebhookEvent.deleteOne({ eventId, status: CLAIM_PROCESSING });
        }
        return { outcome: 'in_flight', store: 'mongo' };
      }
      // 'done', or a legacy row with no status (always meant "seen"): a real duplicate.
      return { outcome: existing ? 'duplicate' : 'in_flight', store: 'mongo' };
    } catch (readError) {
      console.error('[Webhook] MongoDB replay protection unavailable:', readError.message);
      return { outcome: 'unavailable', store: 'mongo' };
    }
  }
}

/** Mark a claimed event done. Best-effort: if it fails the claim just expires. */
export async function finishEvent(claim, eventId) {
  try {
    if (claim.store === 'redis') {
      await getRedisClient().set(claim.key, CLAIM_DONE, 'EX', DONE_TTL_S);
    } else {
      await WebhookEvent.updateOne({ eventId }, { $set: { status: CLAIM_DONE } });
    }
  } catch (err) {
    // Worst case a later retry re-runs the handler, which is idempotent on its own.
    console.warn(`[Webhook] Could not mark event ${eventId} done:`, err.message);
  }
}

/** Give a claim back after a failed run so Razorpay's retry processes the event. */
export async function releaseEvent(claim, eventId) {
  try {
    if (claim.store === 'redis') {
      await getRedisClient().del(claim.key);
    } else {
      await WebhookEvent.deleteOne({ eventId, status: CLAIM_PROCESSING });
    }
  } catch (err) {
    // The processing window still expires on its own; the retry after it will run.
    console.error(`[Webhook] Could not release event ${eventId} after a failed run:`, err.message);
  }
}

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
    const eventType = webhookData.event;
    // Razorpay delivers the unique event ID in the `x-razorpay-event-id` HEADER —
    // the webhook BODY has no top-level `id`. Using webhookData.id made eventId
    // `undefined`, so every event collided on `razorpay:event:undefined` and was
    // dropped as a duplicate after the first (orders stuck at awaiting_payment).
    // Fall back to a deterministic per-event key derived from the entity so replay
    // protection stays unique even if the header is ever absent.
    const entity =
      webhookData.payload?.payment?.entity ||
      webhookData.payload?.order?.entity ||
      webhookData.payload?.refund?.entity ||
      webhookData.payload?.payment_link?.entity;
    const eventId =
      req.headers['x-razorpay-event-id'] ||
      (entity?.id ? `${eventType}:${entity.id}` : `${eventType}:${webhookData.created_at}`);
    const createdAt = webhookData.created_at; // Unix timestamp
    
    // SECURITY STEP 2: Timestamp validation (10-minute window with clock skew tolerance)
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
      // Allowed through to replay protection below, which drops it if already processed.
    }
    
    // SECURITY STEP 3: Validate event type (whitelist only)
    const allowedEvents = ['payment.captured', 'payment.failed', 'order.paid', 'payment_link.paid', 'refund.processed', 'refund.failed'];
    if (!allowedEvents.includes(eventType)) {
      console.log(`[Webhook] Ignoring unknown event type: ${eventType}`);
      return res.status(200).end(); // Safely ignore
    }
    
    // SECURITY STEP 4: Replay protection — CLAIM the event, release it on failure.
    // The claim used to be written as "processed" BEFORE handleWebhook ran, so when
    // processing threw we answered 500 but Razorpay's retry was then 200'd as a
    // duplicate and the payment was never recorded. Now a claim is "processing"
    // while we work, becomes "done" only on success, and is deleted on failure so
    // the retry runs for real. See claimEvent/finishEvent/releaseEvent below.
    const claim = await claimEvent(eventId, eventType);
    if (claim.outcome === 'duplicate') {
      console.log(`[Webhook] Duplicate event ignored (${claim.store}): ${eventId}`);
      return res.status(200).end();
    }
    if (claim.outcome === 'in_flight') {
      // Another delivery of this event is being processed right now. Don't 200 it —
      // if that run fails, this was the retry that should have saved it. A non-2xx
      // makes Razorpay retry later, when the claim is either done or released.
      console.log(`[Webhook] Event already in flight, asking Razorpay to retry: ${eventId}`);
      return res.status(409).end();
    }
    if (claim.outcome === 'unavailable') {
      // Neither Redis nor MongoDB can record the claim — refuse rather than risk a duplicate.
      return res.status(503).end();
    }

    let result;
    try {
      // Process webhook event (with DB validation)
      result = await razorpayService.handleWebhook(webhookData, eventType);
    } catch (processingError) {
      await releaseEvent(claim, eventId);
      throw processingError;
    }
    await finishEvent(claim, eventId);

    // Liveness heartbeat: record that a valid webhook was just processed. The
    // reconciliation sweep reads this to tell a one-off missed event apart from
    // the whole webhook pipeline being down. Best-effort — never fail on it.
    try {
      const redisClient = getRedisClient();
      if (redisClient) await redisClient.set(WEBHOOK_LAST_SEEN_KEY, Date.now().toString());
    } catch (heartbeatErr) {
      console.warn('[Webhook] Failed to record webhook heartbeat:', heartbeatErr.message);
    }

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
