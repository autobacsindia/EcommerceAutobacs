import mongoose from 'mongoose';
import ReturnRequest from '../models/ReturnRequest.js';
import { RETURN_QUANTITY_CONSUMING_STATUSES } from '../config/returnPolicy.js';
import { summaryPipeline, readSummary } from '../utils/listQuery.js';

// A search looks at no more than this many returns of one list, newest first (all of
// them, today: the whole collection is a few thousand).
const SEARCH_SCAN_CAP = 20000;

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
  /** Is a return for this order still being handled (not finished or rejected)? */
  async hasInFlightForOrder(orderId, statuses) {
    return !!(await ReturnRequest.exists({ order: orderId, status: { $in: statuses } }));
  }

  /**
   * Installation (service) lines of this order already refunded by ANOTHER return —
   * the friendly pre-check in front of the unique_refunded_service_line index.
   * @returns {Promise<string[]>} order line ids
   */
  async refundedServiceLineIds(orderId, excludeReturnId = null) {
    const filter = {
      order: orderId,
      'refund.status': { $in: ['processing', 'completed'] },
      'refund.serviceLines.0': { $exists: true },
    };
    if (excludeReturnId) filter._id = { $ne: excludeReturnId };
    const rows = await ReturnRequest.find(filter).select('refund.serviceLines.orderItemId').lean();
    return rows.flatMap((r) => (r.refund?.serviceLines || []).map((l) => String(l.orderItemId)));
  }

  /**
   * Compare-and-set: apply `update` only while the return still matches `expect` (its
   * status, an unset field…). The serialization point for every team-panel step — a
   * double-click or two people at once get one winner; the loser gets null.
   */
  transitionIf(id, expect, update) {
    return ReturnRequest.findOneAndUpdate({ _id: id, ...expect }, update, { new: true });
  }

  /**
   * One keyset page of returns. `query` already carries the page position and
   * `sort` the order (utils/listQuery.js keysetPage). Bounded by `limit`; never
   * skip/offset (the collection only grows).
   */
  page(query, { sort, limit }) {
    return ReturnRequest.find(query)
      .sort(sort)
      .limit(limit)
      .populate('order', 'orderNumber wpId shippingAddress.fullName salesUser totalAmount')
      .populate('items.product', 'name')
      .select('-video -proofOfPurchase -images -staffFiles -emailsSent')
      .lean();
  }

  /** How many returns match (capped): the "N found" line. */
  async summary(query, cap) {
    const [row] = await ReturnRequest.aggregate(summaryPipeline(query, cap)).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, false);
  }

  /**
   * What the team can search a return by that lives on OTHER documents — the order's
   * number and customer, the product names — one row per return in `query`:
   * { _id, order: { _id, wpId, orderNumber, name, phone }, products: [name] }.
   * The caller matches the words; only the fields named here leave the database.
   */
  async searchRows(query) {
    const rows = await ReturnRequest.aggregate([
      { $match: query },
      // Newest first, so if a list ever outgrows the cap it is the oldest that drop out.
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: SEARCH_SCAN_CAP },
      { $project: { order: 1, customerPhone: 1, products: '$items.product', destination: '$destination.supplierName', claims: '$supplierClaims.supplierName' } },
    ]).option({ maxTimeMS: 5000 });
    /*
      The orders and product names in two batched reads, not a $lookup per row: measured
      on 20,000 returns, 1.3 s with $lookup → 0.15 s batched (scratchpad measure-pr3.mjs).
      Products repeat across returns, so they are read once each.
    */
    const productIds = [...new Set(rows.flatMap((r) => (r.products || []).map(String)))];
    const [orders, products] = await Promise.all([
      mongoose.model('Order').find({ _id: { $in: rows.map((r) => r.order) } },
        { wpId: 1, orderNumber: 1, 'shippingAddress.fullName': 1, 'shippingAddress.phone': 1 }).maxTimeMS(5000).lean(),
      mongoose.model('Product').find({ _id: { $in: productIds } }, { name: 1 }).maxTimeMS(5000).lean(),
    ]);
    const orderById = new Map(orders.map((o) => [String(o._id), {
      _id: o._id, wpId: o.wpId, orderNumber: o.orderNumber, name: o.shippingAddress?.fullName, phone: o.shippingAddress?.phone,
    }]));
    const productById = new Map(products.map((p) => [String(p._id), p]));
    // The shape the search reads (returnService searchTextOf): `order` is a one-element array.
    return {
      rows: rows.map((r) => ({
        ...r,
        order: orderById.has(String(r.order)) ? [orderById.get(String(r.order))] : [],
        products: (r.products || []).map((id) => productById.get(String(id))).filter(Boolean),
      })),
      capped: rows.length >= SEARCH_SCAN_CAP,
    };
  }

  /**
   * Supplier settlements promised but not yet received — the "Suppliers owe us" list —
   * one row per settlement, flattened so a list can filter and keyset on top-level
   * fields: { _id: claim id, returnId, order, claim, supplierName, promisedAt, sortAt,
   * amountPaise, ref (the return's short number) }.
   */
  owedStages() {
    return [
      { $match: { 'supplierClaims.status': 'promised' } },
      { $unwind: '$supplierClaims' },
      { $match: { 'supplierClaims.status': 'promised' } },
      { $project: {
        _id: '$supplierClaims._id', returnId: '$_id', order: 1, claim: '$supplierClaims',
        supplierName: '$supplierClaims.supplierName',
        promisedAt: '$supplierClaims.settlement.promisedAt',
        // What the date sorts page on. Never null: a null cannot sit in a keyset cursor,
        // and `$lt <date>` never matches one, so an undated promise would drop out of
        // every page after the first. Falls back to the return's own date.
        sortAt: { $ifNull: ['$supplierClaims.settlement.promisedAt', '$createdAt'] },
        amountPaise: { $ifNull: ['$supplierClaims.settlement.amountPaise', 0] },
        ref: { $toUpper: { $substrCP: [{ $toString: '$_id' }, 16, 8] } },
      } },
    ];
  }

  /** One keyset page of owed settlements; `query` carries the filters and the page position. */
  owedPage(query, { sort, limit }) {
    return ReturnRequest.aggregate([...this.owedStages(), { $match: query }, { $sort: sort }, { $limit: limit }]);
  }

  /** How many owed settlements match, and their total in paise (capped). */
  async owedSummary(query, cap) {
    const [row] = await ReturnRequest.aggregate([...this.owedStages(), ...summaryPipeline(query, cap, 'amountPaise')])
      .option({ maxTimeMS: 5000 });
    return readSummary(row, cap, true);
  }

  /** Totals still owed, per supplier (the summary above the list). Small: one row per supplier. */
  owedTotals() {
    return ReturnRequest.aggregate([
      { $match: { 'supplierClaims.status': 'promised' } },
      { $unwind: '$supplierClaims' },
      { $match: { 'supplierClaims.status': 'promised' } },
      { $group: {
        _id: '$supplierClaims.supplierName',
        amountPaise: { $sum: { $ifNull: ['$supplierClaims.settlement.amountPaise', 0] } },
        claims: { $sum: 1 },
        oldestPromisedAt: { $min: '$supplierClaims.settlement.promisedAt' },
      } },
      { $sort: { oldestPromisedAt: 1 } },
      { $limit: 200 },
    ]);
  }

  /** Requests this customer raised in the window — the repeat-returner flag. */
  countRecentForCustomer({ user, phone }, since) {
    const who = [];
    if (user) who.push({ user });
    if (phone) who.push({ customerPhone: phone });
    if (!who.length) return Promise.resolve(0);
    return ReturnRequest.countDocuments({ $or: who, createdAt: { $gte: since } });
  }

  /** Has the customer email under this key already been accepted by the provider? */
  async wasEmailed(id, key) {
    return !!(await ReturnRequest.exists({ _id: id, 'emailsSent.key': key }));
  }

  /**
   * Record that the email under `key` was sent. Conditional, so two workers racing on
   * the same key leave one entry. Returns true when THIS call recorded it.
   */
  async markEmailed(id, key) {
    const res = await ReturnRequest.updateOne(
      { _id: id, 'emailsSent.key': { $ne: key } },
      { $push: { emailsSent: { key, at: new Date() } } },
    );
    return res.modifiedCount === 1;
  }

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
    shippingShare = 0, serviceLines = [], pickupDeductionReason = null, creditNoteNo = null,
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
      // The fault-based parts of the breakdown (returnRefundBreakdown). `serviceLines`
      // MUST be written in this same update: the unique_refunded_service_line index only
      // serializes two returns claiming one installation line if the line and the
      // `processing` status land together — a later write would leave a window.
      'refund.shippingShare': shippingShare,
      'refund.serviceLines': serviceLines,
      'refund.pickupDeduction': shippingDeduction,
      'refund.pickupDeductionReason': pickupDeductionReason,
      'refund.creditNoteNo': creditNoteNo,
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
   * Undo a refund claim that lost the order's refund fence (orderRepository
   * .advanceRefundSeq): another refund on the same order committed between our read and
   * our claim, so nothing may be paid. The refund goes back to the status it had before
   * the claim, which makes the return claimable again and drops it out of
   * remainingRefundable and the unique service-line index. Matched on `processing` AND
   * the claim's own initiatedAt, so it can only ever undo THIS claim.
   */
  releaseRefundClaim(id, initiatedAt, priorStatus) {
    return ReturnRequest.findOneAndUpdate(
      { _id: id, 'refund.status': 'processing', 'refund.initiatedAt': initiatedAt },
      { $set: { 'refund.status': priorStatus === 'failed' ? 'failed' : 'pending' } },
      { new: true },
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

  /**
   * Atomically claim the reversal of an OFFLINE refund record — an admin saying the
   * payout recorded here never actually happened.
   *
   * ⚠️ `refund.method: 'offline'` IS THE SAFETY GATE. Money that left through Razorpay
   * is real and cannot be withdrawn by writing fields; if a gateway refund matched here
   * the return would read unrefunded with the cash genuinely gone, and the next admin
   * would refund it again. `razorpayRefundId` being absent is asserted alongside as
   * belt and braces — the offline path never sets it, the gateway path always does.
   *
   * The return goes back to `received` (not `refunded`), because that plus a
   * non-terminal refund is exactly what `claimForRefund` needs to be able to re-claim
   * it — the same rewind the offline path's own phase-1 failure handler performs. The
   * `refunded` timeline entry is dropped for the same reason.
   *
   * Matching on `completed` + `offline` rather than on a `revertedAt` sentinel is what
   * lets a return be marked → reverted → marked again: after this write the refund is
   * `pending`, so a second revert finds nothing to claim.
   *
   * @returns {Promise<Object|null>} the PRE-update document, so the caller can read the
   *   finalAmount and affiliateClawbackPaise whose side effects it must now inverse.
   */
  claimRefundRevert(id, { revertedBy, reason }) {
    return ReturnRequest.findOneAndUpdate(
      {
        _id: id,
        'refund.status': 'completed',
        'refund.method': 'offline',
        $or: [
          { 'refund.razorpayRefundId': { $exists: false } },
          { 'refund.razorpayRefundId': null },
        ],
      },
      {
        $set: {
          'refund.status': 'pending',
          'refund.method': 'original_payment',
          'refund.revertedAt': new Date(),
          'refund.revertedBy': revertedBy,
          'refund.revertReason': reason,
          'refund.completedAt': null,
          status: 'received',
          // Re-arm both once-only guards so a subsequent genuine refund can run its
          // side effects instead of being skipped as already-done.
          'refund.ltvReversed': false,
          'refund.paymentRecorded': false,
        },
        // Cleared for the same reason claimForRefund clears them on a gateway retry:
        // a stale cash reference must not survive onto the next attempt.
        $unset: {
          'refund.offlineMethod': '',
          'refund.reference': '',
          'refund.paidAt': '',
          'refund.affiliateClawbackPaise': '',
          'refund.paymentRecordedPaise': '',
          'refund.ltvDecrementedPaise': '',
        },
        $pull: { timeline: { status: 'refunded' } },
      },
      { new: false }
    );
  }

  /**
   * Persist what this refund's side effects ACTUALLY applied, in paise.
   *
   * Written only on the success path, so a revert reverses exactly what was added. The
   * `ltvReversed` / `paymentRecorded` claim flags cannot serve this purpose — they are
   * set BEFORE the work and stay `true` when it throws.
   */
  setAppliedAmounts(id, applied = {}) {
    const set = {};
    for (const key of ['affiliateClawbackPaise', 'paymentRecordedPaise', 'ltvDecrementedPaise']) {
      if (applied[key] !== undefined) set[`refund.${key}`] = applied[key];
    }
    if (!Object.keys(set).length) return Promise.resolve(null);
    return ReturnRequest.updateOne({ _id: id }, { $set: set });
  }
}

export default new ReturnRequestRepository();
