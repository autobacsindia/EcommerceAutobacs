import SubscriptionDue from '../models/SubscriptionDue.js';
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

  /** Keyset page: `query` already carries the "after the cursor" clause. */
  page: (query, { sort, limit }) => SubscriptionDue.find(query)
    .sort(sort)
    .limit(limit)
    .select('-history -files.publicId -files.provider')
    .lean(),

  /** How many match, counted over at most `cap` rows. */
  summary: async (query, cap) => {
    const [row] = await SubscriptionDue.aggregate(summaryPipeline(query, cap)).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, false);
  },
};

export default subscriptionDueRepository;
