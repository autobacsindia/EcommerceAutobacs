import OrderExtraCharge from '../models/OrderExtraCharge.js';

/** Extra charges on orders. Data access only — the rules live in services/orderExtraChargeService.js. */
const MAX_ROWS_PER_ORDER = 50;

const orderExtraChargeRepository = {
  model: OrderExtraCharge,
  create: async (doc) => (await OrderExtraCharge.create(doc)).toObject(),
  findById: (id, session = null) => OrderExtraCharge.findById(id).session(session).lean(),
  findByOrder: (orderId) => OrderExtraCharge.find({ order: orderId }).sort({ sequence: 1 }).limit(MAX_ROWS_PER_ORDER).lean(),
  findByOrderAndKey: (orderId, clientKey) => OrderExtraCharge.findOne({ order: orderId, clientKey }).lean(),
  lastSequence: async (orderId) => (await OrderExtraCharge.findOne({ order: orderId }).sort({ sequence: -1 }).select('sequence').lean())?.sequence || 0,
  countLive: (orderId) => OrderExtraCharge.countDocuments({ order: orderId, status: { $in: ['awaiting_accounts', 'approved', 'paid'] } }),
  // $type: the shape the partial index can serve (measured: a full scan without it).
  findByLinkId: (linkId) => OrderExtraCharge.findOne({ 'links.id': { $eq: linkId, $type: 'string' } }).lean(),
  /** Compare-and-set: returns the new row, or null when someone got there first. */
  transition: (filter, update, options = {}) => OrderExtraCharge.findOneAndUpdate(filter, update, { new: true, ...options }).lean(),
  countAwaitingAccounts: () => OrderExtraCharge.countDocuments({ status: 'awaiting_accounts' }),
  countRefundsDue: () => OrderExtraCharge.countDocuments({ 'refund.status': { $in: ['due', 'failed'], $type: 'string' } }),
  page: (query, { sort, limit }) => OrderExtraCharge.find(query).sort(sort).limit(limit).select('-history').lean(),

  /** Money received and still kept, per date range. Refund due / in progress / done no longer counts. */
  keptMatch: (from, to) => ({
    status: 'paid',
    paidAt: { $gte: from, ...(to ? { $lt: to } : {}) },
    $or: [{ 'refund.status': { $exists: false } }, { 'refund.status': 'failed' }],
  }),
  async sumKept(from, to, maxTimeMS = 5000) {
    const [row] = await OrderExtraCharge.aggregate([
      { $match: this.keptMatch(from, to) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).option({ maxTimeMS });
    return row?.total || 0;
  },
  keptByBucket(from, to, unit, maxTimeMS = 5000) {
    return OrderExtraCharge.aggregate([
      { $match: this.keptMatch(from, to) },
      { $group: { _id: { $dateTrunc: { date: '$paidAt', unit } }, total: { $sum: '$amount' } } },
    ]).option({ maxTimeMS });
  },
};

export default orderExtraChargeRepository;
