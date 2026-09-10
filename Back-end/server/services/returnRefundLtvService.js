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
 *
 * ⚠️ ANY FURTHER EXACTLY-ONCE SIDE EFFECT OF THIS REFUND GOES *BEHIND* THIS CLAIM,
 * NOT BESIDE IT. The claim and the work it describes must move together; a second
 * effect behind a second claim creates a split brain where a row can be flagged as
 * handled by one guard while the other never ran. That is why the affiliate commission
 * clawback below lives inside this function rather than being called alongside it.
 */

import returnRequestRepository from '../repositories/returnRequestRepository.js';
import userRepository from '../repositories/userRepository.js';
import affiliateCommissionService from './affiliateCommissionService.js';

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

    /*
      ⚠️ THE AFFILIATE CLAWBACK RUNS FIRST, AND IS NOT GATED ON `rr.user`.

      It used to sit after an `if (!rr.user || amountPaise <= 0) return` early exit — and
      that exit happens AFTER `claimLtvReversal` has already burned the one-shot claim.
      So a return on an order with no registered user (an offline/admin return, a legacy
      import) skipped the clawback PERMANENTLY: the claim was spent, nothing would ever
      call it again, and the affiliate stayed paid in full for goods that came back.

      The two effects have different preconditions and must not share a guard:
        - the LTV decrement needs a USER to decrement, and a non-zero amount;
        - the clawback needs only an ORDER, because the commission is attached to the
          order, not to the buyer's account.

      Running it first also means the money-RECOVERY effect is the one that survives if
      anything below throws.

      Best-effort within the claim: a ledger failure must not fail a refund that has
      already left the gateway. It is logged loudly for repair.
    */
    if (rr.order) {
      try {
        await affiliateCommissionService.clawbackForLines(rr.order, rr.items, 'return_refunded');
      } catch (err) {
        const message = `[Affiliate] Commission clawback FAILED for return ${returnId} on order `
          + `${rr.order}. The refund is committed; the affiliate ledger overstates what is `
          + 'owed by that line\'s share and needs manual repair.';
        console.error(message, err.message);
      }
    }

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
