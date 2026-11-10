import mongoose from 'mongoose';
import PaymentRequest from '../models/PaymentRequest.js';
import { readSummary, summaryPipeline } from '../utils/listQuery.js';

/** Counts foreign bills not yet priced — every rupee request is ₹1 or more, so amount 0 means exactly that. */
const PENDING_RUPEES = { $sum: { $cond: [{ $lte: ['$amount', 0] }, 1, 0] } };
// Those same no-rupee rows, as { c: currency, p: hundredths } — summed per currency in
// JS (integers, no float drift) so a list says "+ THB 10,000", never adds baht to rupees.
const NO_RUPEE_UNITS = { $push: { $cond: [{ $lte: ['$amount', 0] }, { c: '$currency', p: { $round: [{ $multiply: [{ $ifNull: ['$foreignAmount', 0] }, 100] }, 0] } }, '$$REMOVE'] } };

/** [{ c, p }] → [{ currency, amount }], biggest first. Rows without a currency (none should exist) are dropped. */
export const sumByCurrency = (rows = []) => {
  const by = new Map();
  for (const { c, p } of rows) if (c && c !== 'INR' && p > 0) by.set(c, (by.get(c) || 0) + p);
  return [...by].sort((a, b) => b[1] - a[1]).map(([currency, paise]) => ({ currency, amount: paise / 100 }));
};

/**
 * Payment requests (models/PaymentRequest.js). Data access only — who may do
 * what lives in services/paymentRequestService.js.
 */
const paymentRequestRepository = {
  create: async (doc, session = null) => (await PaymentRequest.create([doc], { session }))[0].toObject(),
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

  /** Keyset page: `query` already carries the "after the cursor" clause; `sort` is a Mongo sort. */
  page: (query, { sort, limit }) => PaymentRequest.find(query)
    .sort(sort)
    .limit(limit)
    .select('-history -files.publicId -files.provider')
    .lean(),

  /**
   * How many match and what they add up to — counted over at most `cap` rows,
   * so a huge match costs a bounded read. `capped` says the real count is higher.
   */
  summary: async (query, cap) => {
    const pipeline = summaryPipeline(query, cap, 'amount');
    // Foreign bills whose rupees are not known yet (amount 0): the total leaves
    // them out, so the list says how many it left out rather than look complete.
    // Bounded: the pipeline reads at most cap + 1 rows, so the push is too.
    pipeline.at(-1).$group.pending = PENDING_RUPEES;
    pipeline.at(-1).$group.noRupees = NO_RUPEE_UNITS;
    const [row] = await PaymentRequest.aggregate(pipeline).option({ maxTimeMS: 5000 });
    const summary = readSummary(row, cap, true);
    return {
      ...summary,
      pending: summary.capped ? null : row?.pending || 0,
      // Foreign amounts left out of the rupee total, per currency.
      foreign: summary.capped ? null : sumByCurrency(row?.noRupees),
    };
  },

  /** Supplier requests for an order that are not finished (served by payment_request_order). */
  /** The parts raised on these supplier deals (served by payment_request_deal). */
  // `$type` repeats the partial index's filter: without it the planner may not pick the index.
  findForDeals: (dealIds) => PaymentRequest.find({ deal: { $in: dealIds, $type: 'objectId' } })
    .select('number status amount currency foreignAmount part deal createdAt approvedAt payment.paidAt payment.transactionAt')
    .limit(2000) // bounded: ≤ a page of deals × their parts (one part in flight at a time)
    .lean(),

  /** A live one-off (not part of a deal) supplier request covering any of these items. */
  findLivePlainSupplier: (orderId, itemIds, statuses) => PaymentRequest.findOne({
    order: { $eq: orderId, $type: 'objectId' }, kind: 'supplier', deal: null, status: { $in: statuses }, itemIds: { $in: itemIds },
  }).select('number').lean(),

  /** A deal part with money committed (approved / on hold / paid) on these items, or any item. */
  findCommittedDealPart: (orderId, itemIds, statuses) => PaymentRequest.findOne({
    order: { $eq: orderId, $type: 'objectId' }, deal: { $type: 'objectId' }, status: { $in: statuses },
    ...(itemIds.length ? { itemIds: { $in: itemIds } } : {}),
  }).select('number status').lean(),

  // Supplier requests only: an expense linked to the order (a courier charge) never holds its items.
  findOpenForOrder: (orderId) => PaymentRequest.find({
    order: { $eq: orderId, $type: 'objectId' }, kind: 'supplier', status: { $in: ['submitted', 'approved', 'on_hold'] },
  }).select('number status itemIds').lean(),

  /** Every supplier request for an order, for the order panel. */
  findForOrder: (orderId) => PaymentRequest.find({ order: { $eq: orderId, $type: 'objectId' } })
    .sort({ createdAt: -1 })
    .limit(200) // bounded: one order's payments, far above any real order
    .select('number status kind category team amount currency foreignAmount itemIds itemNames payee.name payment createdAt requestedBy requestedByName deal part credit supplier')
    .lean(),

  /**
   * Supplier requests waiting for the admin to pay (approved or on hold), oldest
   * first, for the "To pay, by supplier" view. Bounded: the open queue is small,
   * and `limit` caps it (index payment_request_status).
   */
  // Rupee requests only: a foreign bill is paid on its own, with the bank's rupee debit
  // (one transfer cannot carry several different debits). `$in` with null keeps
  // requests from before currencies existed (no field at all).
  findSupplierToPay: (limit) => PaymentRequest.find({ status: { $in: ['approved', 'on_hold'] }, kind: 'supplier', currency: { $in: ['INR', null] } })
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

  countByStatus: () => PaymentRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' }, pending: PENDING_RUPEES } }]),

  /** Paid since a date, by team (index payment_request_status). */
  paidSinceByTeam: (since) => PaymentRequest.aggregate([
    { $match: { status: 'paid', 'payment.paidAt': { $gte: since } } },
    { $group: { _id: '$team', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
  ]),

  /**
   * Paid since a date with no rupees (paid from a foreign-currency account): the
   * amounts per currency, in hundredths.
   *
   * Hinted onto payment_request_status_amount: { status: 'paid', amount ≤ 0 } is a
   * tiny range there (only foreign-account payments, all time), and the date is
   * checked on just those. Left to itself the planner picked payment_request_status_paid
   * and read every payment of the month — measured on 100,000 requests: 41,675 rows,
   * 43 ms; hinted: only the no-rupee rows.
   */
  paidNoRupeesSince: async (since) => {
    const pipeline = [
      { $match: { status: 'paid', amount: { $lte: 0 }, 'payment.paidAt': { $gte: since } } },
      { $group: { _id: '$currency', p: { $sum: { $round: [{ $multiply: [{ $ifNull: ['$foreignAmount', 0] }, 100] }, 0] } } } },
    ];
    let rows;
    try {
      rows = await PaymentRequest.aggregate(pipeline).hint('payment_request_status_amount');
    } catch (err) {
      // The index missing on a cluster (prod builds no index on deploy): a slower
      // read, never a broken overview. tests/indexDrift catches the drift itself.
      console.warn('[PaymentRequest] paidNoRupeesSince without its index:', err.message);
      rows = await PaymentRequest.aggregate(pipeline);
    }
    return sumByCurrency(rows.map((r) => ({ c: r._id, p: r.p })));
  },

  /** Newest request events for the activity feed. */
  recent: (limit) => PaymentRequest.find({}).sort({ updatedAt: -1 }).limit(limit)
    .select('number kind team amount status history requestedByName payee.name updatedAt').lean(),
};

export default paymentRequestRepository;
