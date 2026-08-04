import BaseRepository from './baseRepository.js';
import Order from '../models/Order.js';

class OrderRepository extends BaseRepository {
  constructor() {
    super(Order);
  }

  async findByUser(userId, options = {}) {
    const { limit = 10, skip = 0, session = null } = options;
    let q = Order.find({ user: userId })
      .populate('items.product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    if (session) q = q.session(session);
    return q;
  }

  async countByUser(userId, session = null) {
    let q = Order.countDocuments({ user: userId });
    if (session) q = q.session(session);
    return q;
  }

  // Full populate for getOrderById — returns lean object (read-only)
  async findWithPopulated(id) {
    return Order.findById(id)
      // wpId + variants (id/wpVariationId) are needed to derive the Meta catalogue
      // content_id per line item (utils/metaCatalogId.js) for CAPI + the order API.
      // The order API strips `variants` before responding (see getOrderById).
      .populate('items.product', 'name images price wpId variants._id variants.wpVariationId')
      .populate('user', 'name email phone')
      .populate('payment')
      .lean();
  }

  /**
   * Load a user's own order with product docs populated (savable Mongoose doc).
   * Used by the return flow to snapshot line prices + read Product.returnPolicy.
   */
  async findOwnedWithProducts(orderId, userId) {
    return Order.findOne({ _id: orderId, user: userId }).populate('items.product');
  }

  /** Mirror the return-request status onto the order summary subdoc. */
  async setReturnRequestStatus(orderId, status) {
    return Order.findByIdAndUpdate(orderId, { 'returnRequest.status': status });
  }

  /**
   * Move the FULFILLMENT axis to `returned` the moment operations approves a return,
   * so the admin Orders column stops reading "Delivered" while a return is in flight.
   *
   * Deliberately NOT routed through orderStatusService.updateOrderStatus(): that path
   * treats `returned` as "the money is back" — it maps paymentStatus → `refunded`,
   * claws back earned karma, releases the coupon, and emails the customer that their
   * order was returned. None of that is true at approval: the goods are still with the
   * customer and the refund amount is decided by hand after inspection. So we move the
   * fulfillment axis ONLY; the payment axis stays `paid` until the real refund lands
   * (returnController.initiateReturnRefund / the refund.* webhook), and the customer
   * already gets the "return approved" email from the return flow.
   *
   * Compare-and-set on `status: 'delivered'` is what makes it idempotent and race-safe:
   * a double-approval, or an order an admin has already moved by hand, matches zero
   * docs and no-ops instead of appending a duplicate history entry.
   *
   * @returns {Promise<boolean>} true when THIS call flipped the order.
   */
  async markReturnedOnReturnApproval(orderId, userId, note = 'Return approved — order marked returned') {
    const res = await Order.updateOne(
      { _id: orderId, status: 'delivered' },
      {
        $set: { status: 'returned' },
        $push: {
          statusHistory: {
            status: 'returned',
            timestamp: new Date(),
            updatedBy: userId,
            reason: 'return_completed',
            notes: note,
          },
        },
      }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Undo the approval-time flip above when the return does NOT go through (failed
   * inspection, or the customer withdrew an approved request) — the order was in fact
   * delivered and kept, so it must not be stranded in the terminal `returned` state.
   *
   * Guarded on `status: 'returned'` AND a payment axis that hasn't been refunded, so a
   * return that already paid money back can never be walked backwards by a late call.
   *
   * @returns {Promise<boolean>} true when THIS call reverted the order.
   */
  async revertReturnToDelivered(orderId, userId, note = 'Return did not complete — order restored to delivered') {
    const res = await Order.updateOne(
      { _id: orderId, status: 'returned', paymentStatus: { $ne: 'refunded' }, 'refundDetails.status': { $ne: 'completed' } },
      {
        $set: { status: 'delivered' },
        $push: {
          statusHistory: {
            status: 'delivered',
            timestamp: new Date(),
            updatedBy: userId,
            reason: 'customer_received',
            notes: note,
          },
        },
      }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Resolve an order by the Razorpay refund id we stored at initiation. Fallback path
   * for the refund webhook when notes.orderId is absent.
   */
  async findOneByRefundId(refundId, session = null) {
    let q = Order.findOne({ 'refundDetails.transactionId': refundId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Atomically claim a cancelled, paid order's refund for processing. Compare-and-set is
   * the serialization point that makes refund initiation idempotent under a double-click
   * or concurrent admin requests: only the first caller transitions the order into
   * `processing` and gets `true`; every racing caller gets `false` and must not call the
   * gateway.
   *
   * The match also accepts an order with NO refundDetails (legacy / WooCommerce-imported
   * orders cancelled before the auto-flag existed), stamping a full-refund record so those
   * are refundable too — never a `processing`/`completed` order.
   *
   * @param {Object} order - Hydrated order (needs _id + totalAmount for a fresh record)
   * @param {string} userId - Admin performing the refund
   */
  async markRefundProcessing(order, userId, session = null) {
    const res = await Order.updateOne(
      {
        _id: order._id,
        status: 'cancelled',
        paymentStatus: 'paid',
        $or: [
          { 'refundDetails.status': { $in: ['pending', 'failed'] } },
          { refundDetails: { $exists: false } },
          { 'refundDetails.status': { $exists: false } }
        ]
      },
      {
        $set: {
          'refundDetails.amount': order.refundDetails?.amount ?? order.totalAmount,
          'refundDetails.refundType': order.refundDetails?.refundType || 'full',
          'refundDetails.refundMethod': order.refundDetails?.refundMethod || 'original_payment',
          'refundDetails.requestedAt': order.refundDetails?.requestedAt || new Date(),
          'refundDetails.status': 'processing',
          'refundDetails.processedBy': userId,
          'refundDetails.failureReason': null,
          // Re-arm the once-only Payment.refundAmount claim for this fresh attempt.
          'refundDetails.paymentRecorded': false,
          // Drop any note left by a PRIOR return refund that mirrored itself onto this
          // subdoc. refundMathService.remainingRefundable treats a "Return <id>" note as
          // "already counted via the ReturnRequest", so a stale one surviving into a
          // genuine cancellation refund would hide that refund from the running total.
          'refundDetails.notes': null,
          // Clear any id/timestamp from a prior attempt so a late webhook for the OLD
          // refund can't be mis-attributed to this new one (the mismatch guard in
          // applyRefundWebhook rejects a webhook whose id ≠ the freshly stored one).
          'refundDetails.transactionId': null,
          'refundDetails.processedAt': null
        }
      },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Record the outcome of a gateway refund call WITHOUT a read-modify-write. Conditioning
   * the update on `refundDetails.status === 'processing'` makes it a no-op if a concurrent
   * refund.processed/failed webhook already advanced the order to a terminal state, so the
   * controller can never clobber the webhook (or vice-versa).
   *
   * @param {string} orderId
   * @param {Object} opts
   * @param {string} opts.refundId   - Razorpay refund id to stamp
   * @param {boolean} opts.completed - true when the gateway already returned `processed`
   *                                   (instant speed); false leaves it `processing` for the
   *                                   webhook to complete.
   */
  async recordRefundResult(orderId, { refundId, completed }, session = null) {
    const set = { 'refundDetails.transactionId': refundId };
    if (completed) {
      set['refundDetails.status'] = 'completed';
      set['refundDetails.processedAt'] = new Date();
      set['paymentStatus'] = 'refunded';
    }
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.status': 'processing' },
      { $set: set },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Flag an in-flight refund as failed (gateway threw). Conditional on `processing` for the
   * same anti-clobber reason as recordRefundResult; an admin can retry from the button.
   */
  /**
   * Atomically claim the cumulative Payment.refundAmount write for this order, once.
   * Twin of returnRequestRepository.claimPaymentRecord — see there for why the $inc
   * needs a claim at all (controller racing its own refund.processed webhook).
   */
  async claimRefundPaymentRecord(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.paymentRecorded': { $ne: true } },
      { $set: { 'refundDetails.paymentRecorded': true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  async markRefundFailed(orderId, reason, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, 'refundDetails.status': 'processing' },
      { $set: { 'refundDetails.status': 'failed', 'refundDetails.failureReason': reason } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  async findWithRefunds(statusFilter, session = null) {
    // Legacy / WooCommerce-imported orders cancelled while paid never got a refundDetails
    // subdoc but are still refundable — surface them as effectively 'pending' so they're
    // actionable from the refunds screen, not just the order detail page.
    const legacyDue = {
      status: 'cancelled',
      paymentStatus: 'paid',
      'refundDetails.status': { $exists: false }
    };

    // A *real* refund is always stamped with `refundDetails.requestedAt` at write
    // time. Requiring it excludes phantom subdocs (the removed `status: 'pending'`
    // schema default left every order with an empty refundDetails), so the queue is
    // correct even before the cleanup migration has run.
    const realRefund = { 'refundDetails.requestedAt': { $exists: true } };

    let query;
    if (statusFilter && statusFilter !== 'all') {
      query = statusFilter === 'pending'
        ? { $or: [{ ...realRefund, 'refundDetails.status': 'pending' }, legacyDue] }
        : { ...realRefund, 'refundDetails.status': statusFilter };
    } else {
      query = { $or: [realRefund, legacyDue] };
    }

    let q = Order.find(query)
      .populate('user', 'name email')
      .sort({ 'refundDetails.requestedAt': -1, createdAt: -1 });
    if (session) q = q.session(session);
    return q;
  }

  async findAllAdmin(query, options = {}) {
    const { limit = 20, skip = 0, sort = { createdAt: -1 }, session = null } = options;
    let q = Order.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Orders that may have paid but were never confirmed — the reconciliation sweep's
   * candidate set. Still in the pre-payment fulfillment state, not yet marked paid,
   * carrying a gateway order id (so there is something to ask Razorpay about), and
   * created inside the [maxAge, minAge] window: old enough that a webhook would
   * normally have arrived, young enough that chasing it is still worthwhile.
   * Returns full docs (not lean) — reconcileOrder mutates + saves them.
   * @param {{ minCutoff: Date, maxCutoff: Date, limit?: number }} args
   */
  async findStuckAwaitingPayment({ minCutoff, maxCutoff, limit = 50 }) {
    return Order.find({
      status: 'awaiting_payment',
      // Chase anything not yet paid (incl. failed/cancelled — the client can report a
      // failure that the gateway actually captured), but never an `expired` order: the
      // abandoned-sweep only sets that AFTER this window closes, so it is a settled
      // "customer walked away", not a webhook to recover.
      paymentStatus: { $nin: ['paid', 'expired'] },
      razorpayOrderId: { $ne: null },
      createdAt: { $lt: minCutoff, $gt: maxCutoff },
    })
      .sort({ createdAt: 1 })
      .limit(limit);
  }

  // Status-history fetch for orderStatusService (special populate + select)
  async findForStatusHistory(id, session = null) {
    let q = Order.findById(id)
      .populate('statusHistory.updatedBy', 'name email role')
      .select('statusHistory status');
    if (session) q = q.session(session);
    return q;
  }

  async save(order, session = null) {
    if (session) return order.save({ session });
    return order.save();
  }

  async deleteDoc(order, session = null) {
    if (session) return order.deleteOne({ session });
    return order.deleteOne();
  }

  /** Count a user's orders that "count" as a prior purchase (coupon firstOrderOnly). */
  async countActiveByUser(userId, session = null) {
    let q = Order.countDocuments({ user: userId, status: { $nin: ['cancelled', 'failed'] } });
    if (session) q = q.session(session);
    return q;
  }

  async markKarmaAwarded(orderId, session = null) {
    return Order.updateOne({ _id: orderId }, { karmaAwarded: true }, session ? { session } : {});
  }

  /**
   * Atomically flag this order's purchase as counted. Returns true ONLY on the
   * first successful flip, so the caller runs the CRM purchase denorm + net-LTV
   * increment exactly once per order — even if the order re-enters `processing`
   * (admin backward transition, webhook retry). Compare-and-set is race-safe.
   */
  async markPurchaseCountedOnce(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, purchaseCounted: { $ne: true } },
      { $set: { purchaseCounted: true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Atomically flag this order's purchase as REVERSED. Returns true ONLY on the
   * first flip, and ONLY for an order that was actually counted — so the caller
   * runs the net-LTV / paid-count reversal exactly once, and never for an order
   * that never contributed (unpaid cancel, retried refund job). Mirror of
   * markPurchaseCountedOnce. (PAY-2 / ADR-006)
   */
  async markPurchaseReversedOnce(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, purchaseCounted: true, purchaseReversed: { $ne: true } },
      { $set: { purchaseReversed: true } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }

  /**
   * Atomically claim the invoice-email slot: stamp invoiceEmailedAt only if it was
   * still unset. Returns true for the single winning caller, false if the invoice
   * was already sent or is being sent by a concurrent job. Replaces the old
   * read-then-write check that could double-send under concurrent BullMQ delivery.
   * On send failure the caller releases the claim (invoiceEmailedAt = null). (BE-2)
   */
  async claimInvoiceEmail(orderId, session = null) {
    const res = await Order.updateOne(
      { _id: orderId, invoiceEmailedAt: null },
      { $set: { invoiceEmailedAt: new Date() } },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }
}

export default new OrderRepository();
