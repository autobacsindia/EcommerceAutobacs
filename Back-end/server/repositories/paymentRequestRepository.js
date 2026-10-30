import mongoose from 'mongoose';
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
    .select('number status amount itemIds itemNames payee.name payment createdAt requestedBy')
    .lean(),

  /**
   * Supplier requests waiting for the admin to pay (approved or on hold), oldest
   * first, for the "To pay, by supplier" view. Bounded: the open queue is small,
   * and `limit` caps it (index payment_request_status).
   */
  findSupplierToPay: (limit) => PaymentRequest.find({ status: { $in: ['approved', 'on_hold'] }, kind: 'supplier' })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .select('-history -files.publicId -files.provider')
    .lean(),

  /** The paid requests recorded by one transfer (payBatch). */
  findPaidBatch: (batch) => PaymentRequest.find({ status: 'paid', 'payment.batch': batch }).select('_id number').lean(),

  /** Inside a transaction: drop payment screenshots (by stored file) from a paid request. */
  pullProofsInSession: (id, publicIds, session) => PaymentRequest.findOneAndUpdate(
    { _id: id, status: 'paid' },
    { $pull: { files: { kind: 'proof', publicId: { $in: publicIds } } } },
    { new: true, session },
  ).lean(),

  /** Inside a transaction: change a paid request's payment details, add screenshots, log it. */
  editPaidInSession: (id, set, entry, newFiles, session) => PaymentRequest.findOneAndUpdate(
    { _id: id, status: 'paid' },
    { $set: set, $push: { history: entry, ...(newFiles.length ? { files: { $each: newFiles } } : {}) } },
    { new: true, session },
  ).lean(),

  findByIds: (ids) => PaymentRequest.find({ _id: { $in: ids } }).select('-history').lean(),

  /** One request by its PR-0000 number (index payment_request_number). */
  findByNumber: (number) => PaymentRequest.findOne({ number }).select('number kind status supplier payee.name').lean(),

  /**
   * Run `fn(session)` in one transaction: every write in it lands, or none does.
   * withTransaction may re-run `fn` on a transient conflict, so `fn` must not
   * keep state between attempts.
   */
  inTransaction: async (fn) => {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally {
      await session.endSession();
    }
  },

  /** The same compare-and-set as `transition`, inside a caller's transaction session. */
  transitionInSession: (id, from, filter, set, entry, push, session) => PaymentRequest.findOneAndUpdate(
    { _id: id, status: { $in: from }, ...filter },
    { $set: set, $push: { history: entry, ...push } },
    { new: true, session },
  ).lean(),

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
