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
 */

import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import userRepository from '../repositories/userRepository.js';
import { fromPaise } from '../utils/money.js';
import * as Sentry from '@sentry/node';

/**
 * @param {string} orderId
 * @param {string} cancellationId
 * @param {string|object} paymentId - Payment document id
 * @param {number} amountPaise - what actually went back
 * @returns {Promise<{status: 'applied'|'skipped'|'noop'}>}
 */
export const applyCancellationRefundSideEffectsOnce = async (
  orderId, cancellationId, paymentId, amountPaise,
) => {
  const claimed = await orderRepository.claimCancellationRefundSideEffects(orderId, cancellationId);
  if (!claimed) return { status: 'skipped' }; // the other path won the race

  if (!(amountPaise > 0)) return { status: 'noop' };

  if (paymentId) {
    try {
      await paymentRepository.recordRefund(paymentId, fromPaise(amountPaise), 'order_line_cancelled');
    } catch (err) {
      const message = `[Cancellation] Failed to record ₹${fromPaise(amountPaise)} on payment `
        + `${paymentId} for cancellation ${cancellationId}. The refund is committed; the payment `
        + 'row understates what has gone back, which also loosens the refund headroom guard.';
      console.error(message, err.message);
      Sentry.captureMessage(message, 'error');
    }
  }

  try {
    const order = await orderRepository.findById(orderId);
    if (order?.user) await userRepository.decrementSpend(order.user, { amountPaise });
  } catch (err) {
    const message = `[Cancellation] LTV reversal FAILED for cancellation ${cancellationId} on `
      + `order ${orderId} (₹${fromPaise(amountPaise)}). The refund is committed; the customer's `
      + 'totalSpentPaise is overstated by that amount and needs manual repair.';
    console.error(message, err.message);
    Sentry.captureMessage(message, 'error');
  }

  return { status: 'applied' };
};

export default { applyCancellationRefundSideEffectsOnce };
