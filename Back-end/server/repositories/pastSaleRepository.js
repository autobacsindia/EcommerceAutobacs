import PastSale from '../models/PastSale.js';
import Product from '../models/Product.js';
import { PAST_SALE_HISTORY_CAP } from '../config/pastSale.js';

/**
 * Past (offline) sales (models/PastSale.js). Data access only — who may do what
 * lives in services/pastSaleService.js.
 */
const LIST_FIELDS = '-history';

const keysetBefore = (before) => (before
  ? { $or: [{ saleDate: { $lt: before.saleDate } }, { saleDate: before.saleDate, _id: { $lt: before.id } }] }
  : null);

const pastSaleRepository = {
  model: PastSale,

  create: async (doc) => (await PastSale.create(doc)).toObject(),

  /**
   * Insert many in one round trip per chunk, carrying on past duplicates. Returns
   * the positions (in `docs`) that hit a unique index — someone entered that bill
   * between the check and now. Any other failure is thrown, never skipped: the
   * docs were already checked, so a validation error here is a bug, not data.
   */
  insertManyIgnoringDuplicates: async (docs, chunkSize = 500) => {
    const duplicates = new Set();
    for (let start = 0; start < docs.length; start += chunkSize) {
      const chunk = docs.slice(start, start + chunkSize);
      try {
        await PastSale.insertMany(chunk, { ordered: false, throwOnValidationError: true });
      } catch (err) {
        const writeErrors = err?.writeErrors || [];
        if (!writeErrors.length || writeErrors.some((e) => (e.code ?? e.err?.code) !== 11000)) throw err;
        for (const e of writeErrors) duplicates.add(start + (e.index ?? e.err?.index));
      }
    }
    return duplicates;
  },
  findById: (id) => PastSale.findById(id).lean(),

  /** How many of these product ids exist (a sale line may link a catalogue product). */
  countProducts: (ids) => Product.countDocuments({ _id: { $in: ids } }),

  /** Active sales already holding any of these bill numbers / fingerprints. */
  findActiveClashes: ({ invoiceKeys = [], fingerprints = [] }) => {
    const or = [];
    if (invoiceKeys.length) or.push({ invoiceKey: { $in: invoiceKeys } });
    if (fingerprints.length) or.push({ fingerprint: { $in: fingerprints } });
    if (!or.length) return Promise.resolve([]);
    return PastSale.find({ active: true, $or: or })
      .select('_id invoiceKey invoiceNo fingerprint salesUserName saleDate customer.name')
      .lean();
  },

  /**
   * Change a sale only if nobody changed it since it was read (compare-and-set on
   * updatedAt), recording the history entry in the same write.
   */
  updateIf: (id, updatedAt, filter, update, entry) => PastSale.findOneAndUpdate(
    { _id: id, updatedAt, ...filter },
    { ...update, $push: { history: { $each: [entry], $slice: -PAST_SALE_HISTORY_CAP } } },
    { new: true, runValidators: true },
  ).lean(),

  /** Soft-delete every active sale of one upload. */
  deleteBatch: (batchId, { at, by, byName }) => PastSale.updateMany(
    { batchId, active: true },
    {
      $set: { active: false, deletedAt: at, deletedBy: by, deletedByName: byName },
      $push: { history: { $each: [{ at, by, byName, action: 'deleted' }], $slice: -PAST_SALE_HISTORY_CAP } },
    },
  ),

  /** Keyset page, newest sale first. */
  page: (query, { before = null, limit }) => {
    const after = keysetBefore(before);
    return PastSale.find(after ? { $and: [query, after] } : query)
      .sort({ saleDate: -1, _id: -1 })
      .limit(limit)
      .select(LIST_FIELDS)
      .lean();
  },

  /** Count and value per salesman for active sales matching `match`. */
  totalsBySeller: (match) => PastSale.aggregate([
    { $match: { ...match, active: true } },
    {
      $group: {
        _id: '$salesUser',
        name: { $last: '$salesUserName' },
        sales: { $sum: 1 },
        value: { $sum: '$totalAmount' },
      },
    },
    { $sort: { value: -1 } },
  ]),

  /** A customer's past purchases (staff lookups), newest first. */
  findByPhoneKey: (phoneKey, limit) => PastSale.find({ 'customer.phoneKey': phoneKey, active: true })
    .sort({ saleDate: -1 })
    .limit(limit)
    .select('saleDate invoiceNo items totalAmount paymentMethod channel salesUserName customer.name')
    .lean(),
};

export default pastSaleRepository;
