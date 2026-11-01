import BankTransfer from '../models/BankTransfer.js';
import { readSummary, summaryPipeline } from '../utils/listQuery.js';

/**
 * Bank transfers (models/BankTransfer.js). Data access only — who may do what
 * lives in services/bankTransferService.js.
 */
const bankTransferRepository = {
  model: BankTransfer,
  create: async (doc) => (await BankTransfer.create(doc)).toObject(),
  findById: (id, session = null) => BankTransfer.findById(id).session(session).lean(),
  /** A pending or confirmed transfer already carrying this UTR, if any. */
  findActiveByReference: (referenceKey) => BankTransfer.findOne({ referenceKey, active: true }).select('_id orderNumber status').lean(),
  countPending: () => BankTransfer.countDocuments({ status: 'pending' }),
  /** Correct a pending transfer, only if nobody changed it since it was read (compare-and-set). */
  updatePendingIf: (id, updatedAt, set, entry) => BankTransfer.findOneAndUpdate(
    { _id: id, status: 'pending', updatedAt },
    { $set: set, $push: { history: entry } },
    { new: true },
  ).lean(),

  /** Keyset page: `query` already carries the "after the cursor" clause; `sort` is a Mongo sort. */
  page: (query, { sort, limit }) => BankTransfer.find(query)
    .sort(sort)
    .limit(limit)
    .select('-files.publicId -files.provider')
    .lean(),

  /** How many match and their total, counted over at most `cap` rows. */
  summary: async (query, cap) => {
    const [row] = await BankTransfer.aggregate(summaryPipeline(query, cap, 'amount')).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, true);
  },
};

export default bankTransferRepository;
