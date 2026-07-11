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
      .populate('items.product', 'name images price')
      .populate('user', 'name email')
      .populate('payment')
      .lean();
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

    let query;
    if (statusFilter && statusFilter !== 'all') {
      query = statusFilter === 'pending'
        ? { $or: [{ 'refundDetails.status': 'pending' }, legacyDue] }
        : { 'refundDetails.status': statusFilter };
    } else {
      query = { $or: [{ refundDetails: { $exists: true, $ne: null } }, legacyDue] };
    }

    let q = Order.find(query)
      .populate('user', 'name email')
      .sort({ 'refundDetails.requestedAt': -1, createdAt: -1 });
    if (session) q = q.session(session);
    return q;
  }

  async findAllAdmin(query, options = {}) {
    const { limit = 20, skip = 0, session = null } = options;
    let q = Order.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    if (session) q = q.session(session);
    return q;
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
