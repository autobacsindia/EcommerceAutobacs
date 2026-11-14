import Supplier from '../models/Supplier.js';
import { readSummary, summaryPipeline } from '../utils/listQuery.js';

/**
 * Suppliers (models/Supplier.js). Data access only — who may do what lives in
 * services/supplierService.js. The account number is never selected unless a
 * caller asks for it with `withAccount`.
 */
const withAccount = (q, yes) => (yes ? q.select('+payment.accountNumber') : q);

const supplierRepository = {
  create: async (doc) => (await Supplier.create(doc)).toObject(),
  findById: (id, { account = false } = {}) => withAccount(Supplier.findById(id), account).lean(),

  /** Name, WhatsApp number and active flag of several suppliers (supplier enquiries). */
  findContacts: (ids) => Supplier.find({ _id: { $in: ids } }).select('name phone active').lean(),

  /** Save changes through the document so the account-number setter encrypts. */
  update: async (id, set) => {
    const doc = await Supplier.findById(id).select('+payment.accountNumber');
    if (!doc) return null;
    doc.set(set);
    await doc.save();
    return doc.toObject();
  },

  /** Keyset page: `query` already carries the "after the cursor" clause; `sort` is a Mongo sort. */
  page: (query, { sort, limit }) => Supplier.find(query).sort(sort).limit(limit).lean(),

  /** How many match, counted over at most `cap` rows. */
  summary: async (query, cap) => {
    const [row] = await Supplier.aggregate(summaryPipeline(query, cap)).option({ maxTimeMS: 5000 });
    return readSummary(row, cap, false);
  },
};

export default supplierRepository;
