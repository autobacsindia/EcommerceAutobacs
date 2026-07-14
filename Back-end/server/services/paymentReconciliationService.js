/**
 * Payment reconciliation sweep.
 *
 * The Razorpay webhook is our primary confirmation path, but a webhook can be
 * missed: a misconfigured Live-mode webhook URL/secret at cutover, a delivery
 * outage, or the endpoint being briefly unreachable. When that happens the money
 * is captured at the gateway while our order sits in `awaiting_payment` forever —
 * a silent "took the payment, no order" incident.
 *
 * This sweep closes that gap. It periodically asks Razorpay, for every stuck
 * order, "was this actually paid?" and drives genuinely-captured ones through the
 * SAME idempotent success path the webhook uses. The webhook becomes an
 * optimisation (fast path), not a single point of failure.
 *
 * It is also the liveness signal for webhook health: recovering an order means a
 * webhook was missed, and finding stuck orders while no webhook has been seen for
 * a while means webhooks may be down entirely. Both are surfaced to Sentry.
 */

import orderRepository from '../repositories/orderRepository.js';
import razorpayService from './razorpayService.js';
import { getRedisClient } from './redisClient.js';
import * as Sentry from '@sentry/node';

// Only reconcile orders old enough that a webhook would normally have arrived...
const MIN_AGE_MS = Number(process.env.PAYMENT_RECONCILE_MIN_AGE_MS) || 10 * 60 * 1000; // 10 min
// ...and young enough to still be worth chasing (beyond this a human should look).
const MAX_AGE_MS = Number(process.env.PAYMENT_RECONCILE_MAX_AGE_MS) || 24 * 60 * 60 * 1000; // 24 h
const BATCH = Number(process.env.PAYMENT_RECONCILE_BATCH) || 50;
// If we find stuck orders but no webhook has been seen in this long, webhooks are
// likely down/misconfigured — escalate louder than a per-order "missed" warning.
const WEBHOOK_SILENCE_ALERT_MS = Number(process.env.PAYMENT_WEBHOOK_SILENCE_ALERT_MS) || 60 * 60 * 1000; // 1 h

// Redis key the webhook stamps on every successful delivery (see razorpayWebhook.js).
export const WEBHOOK_LAST_SEEN_KEY = 'razorpay:webhook:last_seen';

/**
 * Run one reconciliation pass. Best-effort and idempotent: any per-order failure is
 * logged and the sweep continues. Returns a summary for logs/metrics.
 * @returns {Promise<{scanned:number, recovered:number, failed:number}>}
 */
export async function reconcileStuckPayments() {
  const now = Date.now();
  const minCutoff = new Date(now - MIN_AGE_MS);
  const maxCutoff = new Date(now - MAX_AGE_MS);

  const stuck = await orderRepository.findStuckAwaitingPayment({ minCutoff, maxCutoff, limit: BATCH });
  if (stuck.length === 0) {
    return { scanned: 0, recovered: 0, failed: 0 };
  }

  let recovered = 0;
  let failed = 0;

  for (const order of stuck) {
    try {
      const result = await razorpayService.reconcileOrder(order);
      if (result.recovered) {
        recovered += 1;
        // A recovered order is proof a webhook was missed. Warn (not error): the
        // customer is now correctly served, but delivery health needs attention.
        console.warn(
          `[Reconcile] Recovered stuck payment | order: ${order._id} | payment: ${result.paymentId} — webhook was missed`
        );
        Sentry.captureMessage('Recovered stuck Razorpay payment via reconciliation (webhook missed)', {
          level: 'warning',
          extra: { orderId: String(order._id), paymentId: result.paymentId, razorpayOrderId: order.razorpayOrderId },
        });
      }
    } catch (err) {
      failed += 1;
      // Amount/currency mismatch or a processing error — never fatal to the sweep.
      console.error(`[Reconcile] Failed to reconcile order ${order._id}:`, err.message);
      Sentry.withScope((scope) => {
        scope.setContext('payment_reconciliation', {
          orderId: String(order._id),
          razorpayOrderId: order.razorpayOrderId,
        });
        scope.setTag('payment_action', 'reconcile_order');
        Sentry.captureException(err);
      });
    }
  }

  // Liveness escalation: stuck orders exist but the webhook has been silent for a
  // long time → the pipeline itself is probably broken, not a one-off miss.
  await maybeAlertWebhooksDown(stuck.length, now);

  console.log(`[Reconcile] Sweep complete | scanned: ${stuck.length} | recovered: ${recovered} | failed: ${failed}`);
  return { scanned: stuck.length, recovered, failed };
}

/**
 * If we found stuck orders and the last webhook we saw is older than the silence
 * threshold (or we've never seen one), raise a loud alert. Best-effort on Redis.
 */
async function maybeAlertWebhooksDown(stuckCount, now) {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    const lastSeenRaw = await redis.get(WEBHOOK_LAST_SEEN_KEY);
    const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
    const silentFor = now - lastSeen;

    if (silentFor > WEBHOOK_SILENCE_ALERT_MS) {
      const ageMsg = lastSeen ? `${Math.round(silentFor / 60000)} min ago` : 'never';
      console.error(
        `[Reconcile] Razorpay webhooks may be DOWN — ${stuckCount} stuck order(s), last webhook seen: ${ageMsg}`
      );
      Sentry.captureMessage('Razorpay webhooks appear DOWN — stuck orders with no recent webhook', {
        level: 'error',
        extra: { stuckCount, lastWebhookSeen: lastSeen ? new Date(lastSeen).toISOString() : 'never' },
      });
    }
  } catch (err) {
    console.warn('[Reconcile] webhook-liveness check skipped:', err.message);
  }
}

export default { reconcileStuckPayments };
