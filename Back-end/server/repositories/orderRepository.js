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

  async findWithRefunds(statusFilter, session = null) {
    const query = { refundDetails: { $exists: true, $ne: null } };
    if (statusFilter && statusFilter !== 'all') {
      query['refundDetails.status'] = statusFilter;
    }
    let q = Order.find(query)
      .populate('user', 'name email')
      .sort({ 'refundDetails.requestedAt': -1 });
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
}

export default new OrderRepository();
