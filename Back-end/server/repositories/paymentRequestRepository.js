import PaymentRequest from '../models/PaymentRequest.js';

/**
 * Payment requests (models/PaymentRequest.js). Data access only — who may do
 * what lives in services/paymentRequestService.js.
 */
const paymentRequestRepository = {
  create: async (doc) => (await PaymentRequest.create(doc)).toObject(),
  findById: (id) => PaymentRequest.findById(id).lean(),

  /**
   * Move a request on, but only if it is still in one of `from` — the guard that
   * makes approve / pay / cancel happen once, however many times they are
   * clicked. Returns the updated request, or null if someone got there first.
   */
  transition: (id, from, set, entry, push = {}) => PaymentRequest.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: set, $push: { history: entry, ...push } },
    { new: true },
  ).lean(),

  /** Keyset page, newest first. */
  page: (query, { before = null, limit }) => PaymentRequest.find(
    before
      ? { $and: [query, { $or: [{ createdAt: { $lt: before.createdAt } }, { createdAt: before.createdAt, _id: { $lt: before.id } }] }] }
      : query,
  )
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .select('-history -files.publicId -files.provider')
    .lean(),

  /** Supplier requests for an order that are not finished (served by payment_request_order). */
  findOpenForOrder: (orderId) => PaymentRequest.find({
    order: orderId, status: { $in: ['submitted', 'approved', 'on_hold'] },
  }).select('number status itemIds').lean(),

  /** Every supplier request for an order, for the order panel. */
  findForOrder: (orderId) => PaymentRequest.find({ order: orderId })
    .sort({ createdAt: -1 })
    .select('number status amount itemIds itemNames payee.name payment createdAt')
    .lean(),

  countByStatus: () => PaymentRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),

  /** Paid since a date, by team (index payment_request_status). */
  paidSinceByTeam: (since) => PaymentRequest.aggregate([
    { $match: { status: 'paid', 'payment.paidAt': { $gte: since } } },
    { $group: { _id: '$team', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
  ]),

  /** Newest request events for the activity feed. */
  recent: (limit) => PaymentRequest.find({}).sort({ updatedAt: -1 }).limit(limit)
    .select('number kind team amount status history requestedByName payee.name updatedAt').lean(),
};

export default paymentRequestRepository;
