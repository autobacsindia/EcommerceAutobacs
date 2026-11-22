import SubscriptionDue from '../models/SubscriptionDue.js';
import PaymentRequest from '../models/PaymentRequest.js';
import { readSummary, summaryPipeline } from '../utils/listQuery.js';

/**
 * Tools / subscriptions and their dues (models/SubscriptionDue.js). Data access
 * only — who may do what lives in services/subscriptionDueService.js.
 */
const subscriptionDueRepository = {
  create: async (doc) => (await SubscriptionDue.create(doc)).toObject(),
  findById: (id) => SubscriptionDue.findById(id).lean(),

  /**
   * Change it only if nobody else has since (`rev` unchanged), it is not archived,
   * and — when `from` is given — it is still in one of those statuses. Bumps `rev`
   * and appends to the history. Returns the updated item, or null if it moved.
   */
  update: (id, { rev, from = null }, set, entry) => SubscriptionDue.findOneAndUpdate(
    { _id: id, rev, archived: false, ...(from ? { status: { $in: from } } : {}) },
    { $set: set, $inc: { rev: 1 }, $push: { history: entry } },
    { new: true, runValidators: true },
  ).lean(),

  /**
   * Mark this cycle paid — only if nobody changed the item since `rev`, it is still
   * verified, live and on this due day, and the cycle is not already marked (a
   * rejected mark does not count: it may be marked again). Inside the caller's
   * transaction. Returns the updated item, or null if any of that moved.
   */
  claimCycle: (id, { rev, dueDate }, cycle, entry, session) => SubscriptionDue.findOneAndUpdate(
    {
      _id: id, rev, archived: false, status: 'verified', dueDate,
      cycles: { $not: { $elemMatch: { dueDate, state: { $ne: 'rejected' } } } },
    },
    { $inc: { rev: 1 }, $push: { cycles: cycle, history: entry } },
    { new: true, runValidators: true, session },
  ).lean(),

  /** Move one cycle (by its _id) to match its expense — only if the item is still at `rev`. */
  settleCycle: (id, rev, cycleId, set, entry) => SubscriptionDue.findOneAndUpdate(
    { _id: id, rev },
    { $set: set, $inc: { rev: 1 }, $push: { history: entry } },
    { new: true, runValidators: true, arrayFilters: [{ 'c._id': cycleId }] },
  ).lean(),

  /** The expenses behind cycles still waiting on accounts / the admin: only what settling needs. */
  expensesFor: (ids) => PaymentRequest.find({ _id: { $in: ids } })
    .select('number status amount currency foreignAmount decisionNote requestedByName subscription history')
    .lean(),

  /**
   * Paid bills per month (by the cycle's due day), newest first. Cycles recorded
   * before "Mark paid" have no state and count as paid. Rupees: the expense's
   * amount once known; a rupee bill's own amount for older cycles; a foreign bill
   * with no rupees yet is counted in `unpriced`, never guessed. Archived items
   * count: what was paid stays paid. Reads one item per subscription (a few
   * hundred at most) and unwinds ~12 cycles a year each.
   */
  monthly: (match, fromDay) => SubscriptionDue.aggregate([
    { $match: match },
    { $unwind: '$cycles' },
    { $match: { 'cycles.dueDate': { $gte: fromDay }, 'cycles.state': { $in: ['paid', null] } } },
    {
      $group: {
        _id: { $substrBytes: ['$cycles.dueDate', 0, 7] },
        bills: { $sum: 1 },
        rupees: { $sum: { $ifNull: ['$cycles.rupees', { $cond: [{ $eq: ['$cycles.currency', 'INR'] }, '$cycles.amount', 0] }] } },
        unpriced: { $sum: { $cond: [{ $and: [{ $eq: [{ $ifNull: ['$cycles.rupees', null] }, null] }, { $ne: ['$cycles.currency', 'INR'] }] }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]).option({ maxTimeMS: 5000 }),

  /** Keyset page: `query` already carries the "after the cursor" clause. */
  page: async (query, { sort, limit }) => (await SubscriptionDue.find(query, { history: 0, 'files.publicId': 0, 'files.provider': 0, cycles: { $slice: -1 } })
    .sort(sort)
    .limit(limit)
    .lean())
    // A row carries only its latest cycle (is this month marked paid?), never the history.
    .map(({ cycles, ...r }) => ({ ...r, lastCycle: cycles?.[0] || null })),

  /** How many match, counted over at most `cap` rows. */
  summary: async (query, cap) => {
    const [row] = await SubscriptionDue.aggregate(summaryPipeline(query, cap)).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, false);
  },
};

export default subscriptionDueRepository;
