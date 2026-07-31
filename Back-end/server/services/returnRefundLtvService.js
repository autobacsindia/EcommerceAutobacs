/**
 * Net-LTV reversal for a completed RETURN refund (partial-refund variant of
 * ADR-006 / PAY-2).
 *
 * A return refund is usually PARTIAL and leaves the order `delivered`, so the
 * order-status-driven reversePurchase() (which reverses the whole order + the
 * paid-order count on a `returned`/`cancelled` transition) does not fit. Here we
 * subtract ONLY the refunded amount from the customer's totalSpentPaise and leave
 * the order count intact — the order still counts as a purchase.
 *
 * Fired from BOTH the immediate-completion path (returnController, when Razorpay
 * returns `processed`) and the refund.processed webhook (razorpayService). The
 * atomic claimLtvReversal() guard makes it fire exactly once across both.
 *
 * Best-effort: never throws into the refund/webhook path — a failed LTV adjustment
 * must not fail a refund that already left the gateway. It is logged for repair.
 */

import returnRequestRepository from '../repositories/returnRequestRepository.js';
import userRepository from '../repositories/userRepository.js';

/**
 * Reverse the net LTV for a completed return refund, exactly once.
 * @param {string} returnId
 * @returns {Promise<{status: 'reversed'|'skipped'|'noop'|'error'}>}
 */
export const reverseReturnLtvOnce = async (returnId) => {
  try {
    // Atomic claim: only the first caller flips refund.ltvReversed and proceeds.
    const rr = await returnRequestRepository.claimLtvReversal(returnId);
    if (!rr) return { status: 'skipped' }; // already reversed (or return not found)

    const amountPaise = Math.round((rr.refund?.finalAmount || 0) * 100);
    if (!rr.user || amountPaise <= 0) return { status: 'noop' };

    await userRepository.decrementSpend(rr.user, { amountPaise });
    console.log(`[ReturnLTV] reversed ₹${rr.refund.finalAmount} for return ${returnId} (user ${rr.user})`);
    return { status: 'reversed' };
  } catch (err) {
    console.error(`[ReturnLTV] reversal failed for return ${returnId}:`, err.message);
    return { status: 'error' };
  }
};

export default { reverseReturnLtvOnce };
