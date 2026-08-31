import mongoose from 'mongoose';
import ReturnRequest from '../models/ReturnRequest.js';
import { RETURN_QUANTITY_CONSUMING_STATUSES } from '../config/returnPolicy.js';

/**
 * ReturnRequest data access. Passthrough to the model so query chaining and
 * instance save() on a loaded return are preserved, while keeping the model
 * import isolated to the repository layer.
 */
class ReturnRequestRepository {
  find(...args) { return ReturnRequest.find(...args); }
  findOne(...args) { return ReturnRequest.findOne(...args); }
  findById(...args) { return ReturnRequest.findById(...args); }
  countDocuments(...args) { return ReturnRequest.countDocuments(...args); }
  create(...args) { return ReturnRequest.create(...args); }
  save(doc) { return doc.save(); }

  /**
   * MONEY-CRITICAL atomic claim: transition a return's refund into `processing`
   * and stamp the operator-entered amounts in ONE conditional update, so it is the
   * serialization point for firing the Razorpay refund. The filter re-asserts the
   * full gate (item received + inspection passed + refund not already processing/
   * completed); a concurrent double-submit therefore has exactly one winner — the
   * loser matches zero docs and gets `null`, and never reaches the gateway. Returns
   * the updated document (or null if the claim was lost / the gate no longer holds).
   */
  /**
   * How many units of each product on this order are already spoken for by a return.
   *
   * "Spoken for" = a return that is in flight or already refunded
   * (RETURN_QUANTITY_CONSUMING_STATUSES). A `rejected` return never took the goods back
   * and a `cancelled` one was withdrawn, so neither consumes quantity.
   *
   * This is what lets a customer come back for the OTHER two of three faulty items:
   * quantity is the bound, not "have you ever returned this product".
   *
   * @param {string} orderId
   * @returns {Promise<Map<string, number>>} productId → units already claimed
   */
  async returnedQuantityByProduct(orderId) {
    const rows = await ReturnRequest.aggregate([
      { $match: { order: new mongoose.Types.ObjectId(String(orderId)),
                  status: { $in: RETURN_QUANTITY_CONSUMING_STATUSES } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', qty: { $sum: '$items.quantity' } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.qty || 0]));
  }

  claimForRefund(id, {
    productValue, listValue, discountShare,
    shippingDeduction, restockingDeduction, finalAmount, initiatedBy,
    method = 'original_payment', offlineMethod = null, reference = null, paidAt = null,
  }) {
    const isOffline = method === 'offline';
    const $set = {
      // Recomputed from the order at initiation time (the create-time snapshot
      // predates discount proration and may be a gross figure) — persisted in the
      // same atomic claim so the stored breakdown always explains finalAmount.
      'refund.productValue': productValue,
      'refund.listValue': listValue,
      'refund.discountShare': discountShare,
      'refund.shippingDeduction': shippingDeduction,
      'refund.restockingDeduction': restockingDeduction,
      'refund.finalAmount': finalAmount,
      // 'offline' records a payout that already happened outside the gateway. It is
      // claimed through this SAME atomic gate as a Razorpay refund on purpose: one
      // serialization point means a double-submit — or one admin recording cash while
      // another fires a gateway refund — still resolves to exactly one payout.
      'refund.method': method,
      // Still `processing` for BOTH methods; the offline caller flips it to `completed`
      // immediately after. A crash in between therefore leaves a claimed, visibly
      // incomplete refund rather than a silently missing one.
      'refund.status': 'processing',
      'refund.initiatedBy': initiatedBy,
      'refund.initiatedAt': new Date(),
      // Fresh attempt → re-arm the once-only payment-record claim, so a retry
      // after a failed gateway call can still write to the Payment row.
      'refund.paymentRecorded': false,
    };

    const update = { $set };
    if (isOffline) {
      $set['refund.offlineMethod'] = offlineMethod;
      $set['refund.reference'] = reference;
      $set['refund.paidAt'] = paidAt || new Date();
    } else {
      // $unset rather than `$set: undefined` (Mongoose strips undefined from an update,
      // which would silently KEEP the old values) and rather than `$set: null` (null
      // fails the enum validator on any later doc.save()). A retry that switches from
      // offline back to the gateway must not leave a stale cash reference behind.
      update.$unset = { 'refund.offlineMethod': '', 'refund.reference': '', 'refund.paidAt': '' };
    }

    return ReturnRequest.findOneAndUpdate(
      {
        _id: id,
        status: 'received',
        'inspection.passed': true,
        'refund.status': { $nin: ['processing', 'completed'] },
      },
      update,
      { new: true }
    );
  }

  /**
   * Atomically claim the net-LTV reversal for a completed refund exactly once. Returns
   * the return document the first time (refund.ltvReversed flips false→true), and null
   * on every subsequent call — so the immediate-completion path and the refund.processed
   * webhook can't both decrement the customer's spend.
   */
  claimLtvReversal(id) {
    return ReturnRequest.findOneAndUpdate(
      { _id: id, 'refund.ltvReversed': { $ne: true } },
      { $set: { 'refund.ltvReversed': true } },
      { new: true }
    );
  }

  /**
   * Atomically claim the cumulative Payment.refundAmount write for this return, once.
   *
   * paymentRepository.recordRefund is an atomic `$inc` and so is NOT idempotent. The
   * immediate-completion path (an instant/optimum refund that comes back `processed`)
   * and the refund.processed webhook can BOTH decide to record: the webhook's
   * "already terminal?" check reads a status the controller has not persisted yet.
   * Whichever gets here first wins; the loser matches zero docs and gets null.
   */
  claimPaymentRecord(id) {
    return ReturnRequest.findOneAndUpdate(
      { _id: id, 'refund.paymentRecorded': { $ne: true } },
      { $set: { 'refund.paymentRecorded': true } },
      { new: true }
    );
  }
}

export default new ReturnRequestRepository();
