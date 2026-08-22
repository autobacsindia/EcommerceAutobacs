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
 * webhook was missed, and finding UNRESOLVED orders while no webhook has been seen
 * for a while means webhooks may be down entirely. Both are surfaced to Sentry.
 *
 * ⚠️ "Unresolved" is narrower than "stuck", and the difference is the whole reason
 * this alert used to be noise — see maybeAlertWebhooksDown() below.
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
 * @returns {Promise<{scanned:number, unresolved:number, recovered:number, failed:number}>}
 *   `unresolved` = of those scanned, how many were still at paymentStatus 'pending'.
 *   That, not `scanned`, is what makes webhook silence meaningful.
 */
export async function reconcileStuckPayments() {
  const now = Date.now();
  const minCutoff = new Date(now - MIN_AGE_MS);
  const maxCutoff = new Date(now - MAX_AGE_MS);

  const stuck = await orderRepository.findStuckAwaitingPayment({ minCutoff, maxCutoff, limit: BATCH });
  if (stuck.length === 0) {
    // Shape must match the full-sweep return, including `unresolved` — callers and
    // dashboards read that field to decide whether webhook silence is meaningful.
    return { scanned: 0, unresolved: 0, recovered: 0, failed: 0 };
  }

  // Snapshot the liveness input BEFORE any recovery runs. The question the alert
  // asks is "how many orders were awaiting an outcome when we looked?", which is a
  // property of the fetched set, not of what the sweep then did to them. Computing
  // it afterwards would silently depend on whether reconcileOrder mutates the
  // in-memory doc (today it does not — it passes an id to processPaymentSuccess —
  // but that is not this function's invariant to rely on).
  const unresolved = stuck.filter((o) => o.paymentStatus === 'pending').length;

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

  // Liveness escalation keys off UNRESOLVED orders only (snapshotted above) — see
  // the note on maybeAlertWebhooksDown. `pending` means we never heard an outcome
  // for this payment; `failed`/`cancelled` mean we did.
  await maybeAlertWebhooksDown(unresolved, now);

  console.log(
    `[Reconcile] Sweep complete | scanned: ${stuck.length} | unresolved: ${unresolved} | recovered: ${recovered} | failed: ${failed}`
  );
  return { scanned: stuck.length, unresolved, recovered, failed };
}

/**
 * If we found UNRESOLVED orders and the last webhook we saw is older than the
 * silence threshold (or we've never seen one), raise a loud alert. Best-effort on
 * Redis.
 *
 * ⚠️ `unresolvedCount`, NOT the sweep's scan count. The sweep deliberately chases
 * `failed` and `cancelled` orders too, because a client-reported failure can sit
 * on top of a payment the gateway actually captured — that is worth an API call.
 * It is NOT worth an alert: a terminal paymentStatus means we DID hear an outcome
 * for that order, so it is evidence of an abandoned checkout, not of a dead
 * webhook pipeline.
 *
 * Conflating the two made this alert fire on ordinary abandoned carts. Measured on
 * production 2026-08-22: over 30 days the old signal had 39 qualifying orders and
 * the new one had 0 — and there was no webhook outage in that window, so 0 is the
 * correct answer. At ~2 orders/day "no webhook in an hour" is otherwise
 * indistinguishable from "nobody paid in an hour", and the alert would have fired
 * most nights until someone learned to ignore it.
 *
 * The dangerous case this still catches is exactly the one worth paging for: a
 * customer pays, the callback never lands (closed tab / dead network) AND the
 * webhook never arrives, so the order sits at `pending` past MIN_AGE_MS with money
 * captured at the gateway.
 */
async function maybeAlertWebhooksDown(unresolvedCount, now) {
  // Nothing unresolved ⇒ every order we scanned already has an outcome ⇒ webhook
  // silence tells us nothing.
  if (unresolvedCount === 0) return;

  try {
    const redis = getRedisClient();
    if (!redis) return;
    const lastSeenRaw = await redis.get(WEBHOOK_LAST_SEEN_KEY);
    const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
    const silentFor = now - lastSeen;

    if (silentFor > WEBHOOK_SILENCE_ALERT_MS) {
      const ageMsg = lastSeen ? `${Math.round(silentFor / 60000)} min ago` : 'never';
      console.error(
        `[Reconcile] Razorpay webhooks may be DOWN — ${unresolvedCount} order(s) awaiting an outcome, last webhook seen: ${ageMsg}`
      );
      Sentry.captureMessage('Razorpay webhooks appear DOWN — orders awaiting an outcome with no recent webhook', {
        level: 'error',
        extra: { unresolvedCount, lastWebhookSeen: lastSeen ? new Date(lastSeen).toISOString() : 'never' },
      });
    }
  } catch (err) {
    console.warn('[Reconcile] webhook-liveness check skipped:', err.message);
  }
}

export default { reconcileStuckPayments };
