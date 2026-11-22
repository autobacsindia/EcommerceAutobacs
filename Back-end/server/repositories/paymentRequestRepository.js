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
const LINKED_FIELDS = 'number kind status team category amount currency foreignAmount payee.name order orderNumber project projectCode projectName task taskNumber taskTitle reimbursement reference requestedByName payment.paidAt payment.transactionAt createdAt'
  .split(' ');
/** At most this many item names ride along as a supplier payment's "what for". */
const PURPOSE_ITEMS_MAX = 10;
/**
 * What a linked-payments page reads. With `purposeChars`, also what each payment
 * was for — cut in the database (`purpose`), so a 12,000-character description
 * never leaves it for a one-line label (measured: a page of long notes read
 * ~137 KB instead of ~7.5 KB).
 */
const linkedFields = (purposeChars) => {
  const fields = Object.fromEntries(LINKED_FIELDS.map((f) => [f, 1]));
  if (purposeChars > 0) {
    fields.purpose = { $substrCP: [{ $ifNull: ['$description', ''] }, 0, purposeChars] };
    fields.itemNames = { $slice: [{ $ifNull: ['$itemNames', []] }, PURPOSE_ITEMS_MAX] };
  }
  return fields;
};

const paymentRequestRepository = {
  /** A paid payment recorded with any of these reference spellings (the slip reader's duplicate check). */
  findPaidByReference: (spellings, excludeId = null) => PaymentRequest.findOne({
    'payment.reference': { $in: spellings }, status: 'paid', ...(excludeId && { _id: { $ne: excludeId } }),
  }).select('number').lean(),
  create: async (doc, session = null) => (await PaymentRequest.create([doc], { session }))[0].toObject(),
  findById: (id) => PaymentRequest.findById(id).lean(),
  /** The request this person already raised with this browser id (payment_request_client_id). */
  findByClientId: (requestedBy, clientId) => PaymentRequest.findOne({ requestedBy, clientId: { $type: 'string', $eq: clientId } }).lean(),

  /**
   * The admin's lookup: a page of the requests linked to a project (payment_request_project)
   * or carrying an other ID (payment_request_reference), newest first. `after` is the last
   * row's { createdAt, _id }; `limit` bounds the read.
   */
  pageLinked: (by, { after = null, limit, purposeChars = 0 }) => {
    // One order's rows ride payment_request_order and are sorted in memory: an order has a handful.
    // Plain equality on the project (an ObjectId from our own read): payment_request_project is a sorted range.
    const base = by.project ? { project: by.project }
      : by.task ? { task: by.task }
      : by.order ? { order: { $eq: by.order, $type: 'objectId' } }
        : { reference: { $eq: by.reference, $gt: '' } };
    // `createdAt ≤ cursor` bounds the index range so the next page starts where the last ended
    // (an $or alone read two pages' worth of keys — measured); the $or then drops the ties already shown.
    const keyset = after
      ? { createdAt: { $lte: after.createdAt }, $or: [{ createdAt: { $lt: after.createdAt } }, { _id: { $lt: after.id } }] }
      : {};
    return PaymentRequest.find({ ...base, ...keyset })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .select(linkedFields(purposeChars))
      .lean();
  },
  /** The orders of a project's payments, each once (payment_request_project; at most `cap` rows read). */
  ordersForProject: async (projectId, cap) => [...new Set((await PaymentRequest.find({ project: projectId, order: { $type: 'objectId' } })
    .select('order').limit(cap).lean()).map((r) => String(r.order)))],
  /** The projects of an order's payments, each once (payment_request_order). */
  projectsForOrder: async (orderId, cap) => [...new Set((await PaymentRequest.find({ order: { $eq: orderId, $type: 'objectId' }, project: { $type: 'objectId' } })
    .select('project').limit(cap).lean()).map((r) => String(r.project)))],
  /** What a project's payments add up to, by status (payment_request_project; one project's rows). */
  totalsForProject: (projectId) => PaymentRequest.aggregate([
    { $match: { project: projectId } },
    { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
  ]).option({ maxTimeMS: 5000 }),
  /** The same, for one task's payments (payment_request_task). */
  totalsForTask: (taskId) => PaymentRequest.aggregate([
    { $match: { task: taskId } },
    { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
  ]).option({ maxTimeMS: 5000 }),

  /** This person's latest request of `category` that named how to pay them. */
  lastOwnPayee: (requestedBy, category) => PaymentRequest.findOne({ requestedBy, category, 'payee.method': { $in: ['upi', 'bank'] } })
    .sort({ createdAt: -1 }).select('payee').lean(),

  /**
   * A month of reimbursements (payment_request_reimbursement_on: by the day spent,
   * 'YYYY-MM-DD' in [from, to)), declined and cancelled left out — per person and
   * per task, in rupees. Bounded: one month's claims; at most `cap` people / tasks.
   */
  reimbursementReport: (from, to, cap) => PaymentRequest.aggregate([
    { $match: { 'reimbursement.on': { $type: 'string', $gte: from, $lt: to }, category: 'reimbursement', status: { $nin: ['declined', 'cancelled'] } } },
    { $project: {
      requestedBy: 1, requestedByName: 1, team: 1, task: 1, taskNumber: 1, taskTitle: 1, amount: 1, status: 1,
      type: '$reimbursement.type', km: { $ifNull: ['$reimbursement.km', 0] },
      paid: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] },
    } },
    { $facet: {
      people: [
        { $group: {
          _id: '$requestedBy', name: { $last: '$requestedByName' }, team: { $last: '$team' },
          count: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: '$paid' }, km: { $sum: '$km' },
          fuel: { $sum: { $cond: [{ $eq: ['$type', 'fuel'] }, '$amount', 0] } },
          food: { $sum: { $cond: [{ $eq: ['$type', 'food'] }, '$amount', 0] } },
          transport: { $sum: { $cond: [{ $eq: ['$type', 'transport'] }, '$amount', 0] } },
          other: { $sum: { $cond: [{ $eq: ['$type', 'other'] }, '$amount', 0] } },
        } },
        { $sort: { amount: -1, _id: 1 } },
        { $limit: cap },
      ],
      tasks: [
        { $match: { task: { $type: 'objectId' } } },
        { $group: {
          _id: '$task', number: { $last: '$taskNumber' }, title: { $last: '$taskTitle' },
          count: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: '$paid' }, km: { $sum: '$km' },
        } },
        { $sort: { amount: -1, _id: 1 } },
        { $limit: cap },
      ],
      total: [{ $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: '$paid' }, km: { $sum: '$km' } } }],
    } },
  ]).option({ maxTimeMS: 10000 }),

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
    .select('-history -edits -files.publicId -files.provider')
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
  findOpenForOrder: (orderId, session = null) => PaymentRequest.find({
    order: { $eq: orderId, $type: 'objectId' }, kind: 'supplier', status: { $in: ['submitted', 'approved', 'on_hold'] },
  }).select('number status itemIds partId').session(session).lean(),

  /** Every supplier request for an order, for the order panel. */
  findForOrder: (orderId) => PaymentRequest.find({ order: { $eq: orderId, $type: 'objectId' } })
    .sort({ createdAt: -1 })
    .limit(200) // bounded: one order's payments, far above any real order
    .select('number status decisionNote kind category team amount currency foreignAmount itemIds itemNames partId partWhat payee.name payment createdAt requestedBy requestedByName deal part credit supplier')
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
    .select('-history -edits -files.publicId -files.provider')
    .lean(),

  /** Just the history of these requests — for the held rows of a list read without it (holdOf). */
  findHistories: (ids) => PaymentRequest.find({ _id: { $in: ids } }).select('history').lean(),

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
  findByNumber: (number) => PaymentRequest.findOne({ number }).select('number kind status supplier payee.name order orderNumber').lean(),

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

  /** Paid in [since, until), by team (index payment_request_status_paid). `until` optional. */
  paidSinceByTeam: (since, until = null) => PaymentRequest.aggregate([
    { $match: { status: 'paid', 'payment.paidAt': { $gte: since, ...(until ? { $lt: until } : {}) } } },
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
  paidNoRupeesSince: async (since, until = null) => {
    const pipeline = [
      { $match: { status: 'paid', amount: { $lte: 0 }, 'payment.paidAt': { $gte: since, ...(until ? { $lt: until } : {}) } } },
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
