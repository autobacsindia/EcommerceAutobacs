import BankTransfer from '../models/BankTransfer.js';

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

  /** Keyset page, newest first. */
  page: (query, { before = null, limit }) => BankTransfer.find(
    before
      ? { $and: [query, { $or: [{ createdAt: { $lt: before.createdAt } }, { createdAt: before.createdAt, _id: { $lt: before.id } }] }] }
      : query,
  )
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .select('-files.publicId -files.provider')
    .lean(),
};

export default bankTransferRepository;
