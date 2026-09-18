/**
 * The two non-idempotent side effects of a completed PARTIAL-CANCELLATION refund.
 *
 * Both the immediate path (cancellationService, when Razorpay returns `processed`) and
 * the refund.processed webhook (razorpayService) must be able to run this, and exactly
 * one of them must win. It lives in its own module rather than on cancellationService
 * because razorpayService cannot import that service — cancellationService imports
 * razorpayService, and the pair would form a cycle. Same shape, and same reason, as
 * services/returnRefundLtvService.js.
 *
 * The two effects:
 *   1. `Payment.refundAmount` — an atomic `$inc`, so running it twice double-counts.
 *   2. The customer's `totalSpentPaise` — a partial cancellation leaves the order a
 *      purchase, so the order COUNT stays put and only the returned money is subtracted.
 *      Without it every partly-cancelled customer reads richer than they are and every
 *      LTV/cohort figure built on that field overstates, silently.
 *
 * Both sit behind ONE claim, so the `ltvAdjusted` / `paymentIncremented` flags and the
 * work they describe move together. Splitting them would let a repair job skip rows
 * that were flagged but never actually adjusted.
 *
 * Best-effort throughout: a failure here must never fail a refund that has already left
 * the gateway. Failures are logged loudly (and to Sentry) for manual repair.
 *
 * ⚠️ ANY FURTHER EXACTLY-ONCE SIDE EFFECT OF THIS REFUND GOES *BEHIND* THIS CLAIM, NOT
 * BESIDE IT — see the note above about a repair job skipping rows that were flagged but
 * never adjusted. The affiliate commission clawback is the third effect, added here for
 * exactly that reason rather than being called alongside this function.
 */

import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import userRepository from '../repositories/userRepository.js';
import affiliateCommissionService from './affiliateCommissionService.js';
import { fromPaise } from '../utils/money.js';
import * as Sentry from '@sentry/node';

/**
 * @param {string} orderId
 * @param {string} cancellationId
 * @param {string|object} paymentId - Payment document id
 * @param {number} amountPaise - what actually went back
 * @returns {Promise<{status, affiliateClawbackPaise, paymentRecordedPaise, ltvDecrementedPaise}>}
 *   Each figure is what that effect ACTUALLY applied, post-clamp, and 0 when the effect
 *   was skipped or threw.
 *
 *   ⚠️ THE CALLER CANNOT INFER THIS FROM THE CLAIM FLAGS. `paymentIncremented` /
 *   `ltvAdjusted` are set BEFORE the work (they are exactly-once guards, not success
 *   records), so they stay `true` when a step throws — and every step here is
 *   best-effort by design, because a failure must never fail a refund that has already
 *   left the gateway. The offline-refund path persists these amounts so a later REVERT
 *   subtracts exactly what was added: reversing a payment `$inc` that never landed would
 *   wipe a sibling refund's contribution off `Payment.refundAmount`, which is the
 *   `Math.max(...)` floor remainingRefundable trusts.
 */
export const applyCancellationRefundSideEffectsOnce = async (
  orderId, cancellationId, paymentId, amountPaise,
) => {
  const NOTHING = { affiliateClawbackPaise: 0, paymentRecordedPaise: 0, ltvDecrementedPaise: 0 };

  const claimed = await orderRepository.claimCancellationRefundSideEffects(orderId, cancellationId);
  if (!claimed) return { status: 'skipped', ...NOTHING }; // the other path won the race

  if (!(amountPaise > 0)) return { status: 'noop', ...NOTHING };

  let paymentRecordedPaise = 0;
  if (paymentId) {
    try {
      await paymentRepository.recordRefund(paymentId, fromPaise(amountPaise), 'order_line_cancelled');
      paymentRecordedPaise = amountPaise;
    } catch (err) {
      const message = `[Cancellation] Failed to record ₹${fromPaise(amountPaise)} on payment `
        + `${paymentId} for cancellation ${cancellationId}. The refund is committed; the payment `
        + 'row understates what has gone back, which also loosens the refund headroom guard.';
      console.error(message, err.message);
      Sentry.captureMessage(message, 'error');
    }
  }

  /*
    The affiliate's share of the cancelled lines.

    Proportional to the refunded amount rather than to named lines: a cancellation
    records a rupee figure and the line detail is not carried through to here, so
    `clawbackForAmount` prorates against the order's goods pot — the best that can
    honestly be derived from an amount. Clamped to what is outstanding, so even a
    double-fire can only ever reduce this order to zero.
  */
  let affiliateClawbackPaise = 0;
  try {
    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, amountPaise, 'order_line_cancelled',
    );
    affiliateClawbackPaise = Math.max(0, Number(clawback?.amountPaise) || 0);
  } catch (err) {
    const message = `[Affiliate] Commission clawback FAILED for cancellation ${cancellationId} `
      + `on order ${orderId} (₹${fromPaise(amountPaise)}). The refund is committed; the `
      + 'affiliate ledger overstates what is owed and needs manual repair.';
    console.error(message, err.message);
    Sentry.captureMessage(message, 'error');
  }

  let ltvDecrementedPaise = 0;
  try {
    const order = await orderRepository.findById(orderId);
    if (order?.user) {
      await userRepository.decrementSpend(order.user, { amountPaise });
      ltvDecrementedPaise = amountPaise;
    }
  } catch (err) {
    const message = `[Cancellation] LTV reversal FAILED for cancellation ${cancellationId} on `
      + `order ${orderId} (₹${fromPaise(amountPaise)}). The refund is committed; the customer's `
      + 'totalSpentPaise is overstated by that amount and needs manual repair.';
    console.error(message, err.message);
    Sentry.captureMessage(message, 'error');
  }

  return { status: 'applied', affiliateClawbackPaise, paymentRecordedPaise, ltvDecrementedPaise };
};

export default { applyCancellationRefundSideEffectsOnce };
