/**
 * The inverse of a completed refund's side effects.
 *
 * Shared by all three revert paths — whole-order cancellation, per-line cancellation,
 * and return — because the money-adjacent consequences of a refund completing are the
 * same wherever it came from, and three copies of this would drift.
 *
 * ── ONLY EVER FOR MONEY THAT NEVER MOVED ────────────────────────────────────────────
 * Every caller must already have established, through an atomic claim matched on
 * `method === 'offline'`, that the refund being withdrawn was a RECORD of an external
 * payout rather than a gateway refund. Nothing in here can pull money back out of
 * Razorpay; it only un-does bookkeeping. Calling it for a real refund would leave the
 * books saying a customer was never refunded while their money is genuinely gone.
 *
 * ── WHY EVERY STEP IS BEST-EFFORT ───────────────────────────────────────────────────
 * The refund record itself is withdrawn by the caller's phase 1, BEFORE this runs. That
 * ordering is deliberate and it is the opposite of the offline RECORD path (which must
 * land the record first, because until it exists a payout is invisible and could be paid
 * twice). Here the risk runs the other way, and the ordering makes the failure mode safe:
 *
 *   `remainingRefundable` takes `Math.max(our records, payment.refundAmount)`. So if the
 *   record is withdrawn but the Payment decrement below fails, the headroom stays
 *   CONSUMED — the refund button returns but an attempt is refused with "nothing left to
 *   refund". Confusing, surfaced as a warning, and impossible to double-pay from. The
 *   reverse ordering would open exactly the double-payout this codebase spends most of
 *   its refund logic preventing.
 *
 * So a failure here is never allowed to roll phase 1 back. It is collected, logged,
 * reported to the admin, and sent to Sentry for repair.
 */

import paymentRepository from '../repositories/paymentRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import affiliateCommissionService from './affiliateCommissionService.js';
import { notificationKey } from './orderStatusEmailService.js';
import { fromPaise } from '../utils/money.js';
import * as Sentry from '@sentry/node';

/**
 * Run one reversal step without letting it fail the reversal as a whole.
 * @param {string[]} warnings - collected labels of what did not complete
 */
const bestEffort = async (warnings, what, context, fn) => {
  try {
    await fn();
  } catch (err) {
    warnings.push(what);
    console.error(`[RefundRevert] ${context.label}: ${what} failed — ${err.message}`);
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('refund_revert', { ...context, step: what });
        scope.setTag('payment_action', 'refund_revert');
        scope.setTag('severity', 'high');
        Sentry.captureException(err);
      });
    }
  }
};

/**
 * Inverse every side effect a completed offline refund had.
 *
 * @param {object}  args
 * @param {string}  args.orderId
 * @param {string|null} args.userId       - the customer, for the LTV re-credit
 * @param {string|object|null} args.paymentId
 * @param {number}  args.amountPaise      - what actually landed on the Payment row
 * @param {number}  [args.ltvPaise]       - what was actually taken off the customer's
 *   spend; defaults to `amountPaise` for the surfaces where the two are the same figure
 * @param {number}  args.affiliateClawbackPaise - what the clawback actually took at mark time
 * @param {boolean} args.restorePaidStatus - whether the mark had flipped the order to `refunded`
 * @param {string}  args.label            - for logs, e.g. `order 65f… refund`
 * @param {string}  [args.reason]
 * @returns {Promise<{warnings: string[]}>}
 */
export const reverseRefundSideEffects = async ({
  orderId, userId = null, paymentId = null, amountPaise = 0, ltvPaise = null,
  affiliateClawbackPaise = 0, restorePaidStatus = false, label, reason = 'refund_reverted',
}) => {
  const warnings = [];
  const context = { orderId: String(orderId), amountPaise, label };
  const amount = Math.max(0, Math.round(Number(amountPaise) || 0));
  // The two diverge when one effect landed and the other did not — which is exactly the
  // case this function has to get right.
  const ltvAmount = Math.max(0, Math.round(Number(ltvPaise ?? amountPaise) || 0));

  /*
    The Payment row FIRST, because it is the headroom floor: until it comes down the
    order cannot be refunded again, so this is the step that actually restores the
    ability to do the right thing. Everything after it is reporting.

    ⚠️ `amountPaise` is what the mark ACTUALLY put on the row (`paymentRecordedPaise`),
    so 0 here means the `$inc` never landed and there is nothing to take back. Reversing
    the refund's face value regardless would subtract money that was never added and wipe
    a SIBLING refund's contribution off `Payment.refundAmount` — the `Math.max(...)` floor
    `remainingRefundable` trusts — silently freeing headroom for a second payout.
  */
  if (paymentId && amount > 0) {
    await bestEffort(warnings, 'payment row', context, () =>
      paymentRepository.reverseRefund(paymentId, fromPaise(amount)));
  }

  /*
    The affiliate ledger, with the EXACT paise the clawback took — read from the refund
    record, never re-derived. See affiliateCommissionService.reinstateForAmount.

    Not gated on `userId`: the commission is attached to the ORDER, not to the buyer's
    account, so an offline/admin refund on an order with no registered user still has a
    ledger entry to put back. That asymmetry is the same bug reverseReturnLtvOnce was
    fixed for — an early return on a missing user skipping the clawback permanently.
  */
  if (affiliateClawbackPaise > 0) {
    await bestEffort(warnings, 'affiliate commission', context, () =>
      affiliateCommissionService.reinstateForAmount(orderId, affiliateClawbackPaise, reason));
  }

  /*
    Net LTV back up by exactly what the refund took off — `ltvDecrementedPaise`, recorded
    on the success path of the decrement, NOT the refund's face value and NOT the
    `ltvAdjusted` / `ltvReversed` claim flag. Those flags are set before the work and stay
    `true` when it throws (reverseReturnLtvOnce swallows a failed decrementSpend
    entirely), so trusting them would credit back spend that was never taken.
  */
  if (userId && ltvAmount > 0) {
    await bestEffort(warnings, 'customer lifetime value', context, () =>
      userRepository.incrementSpend(userId, { amountPaise: ltvAmount }));
  }

  // Payment axis: only if the mark had moved it. A partial refund leaves an order
  // `paid` throughout, and there is nothing to restore.
  if (restorePaidStatus) {
    await bestEffort(warnings, 'order payment status', context, () =>
      orderRepository.restorePaidAfterRevert(orderId));
  }

  /*
    Drop the 'refunded' email stamp.

    Without this the customer is never told about the REAL refund when it later goes
    out: emailOrderStatusUpdate skips any status already listed in notifiedStatuses, so
    the stamp left by the withdrawn record would silently suppress the genuine one.
  */
  await bestEffort(warnings, 'email notification stamp', context, () =>
    orderRepository.clearNotifiedStatus(orderId, notificationKey('refunded')));

  return { warnings };
};

export default { reverseRefundSideEffects };
