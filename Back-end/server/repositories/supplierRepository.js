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

  /** The supplier saved under this name key (unique index supplier_name). */
  findByNameKey: (nameKey) => Supplier.findOne({ nameKey }).select('name nameKey active').lean(),

  /**
   * A supplier whose phone ends in these ten digits, whatever the spacing or +91.
   * No index: suppliers are a few hundred rows, and this runs only when someone
   * saves a new supplier from a payment.
   */
  findByPhoneKey: (last10) => {
    const pattern = `${String(last10).replace(/\D/g, '').split('').join('\\D*')}\\D*$`;
    return Supplier.findOne({ phone: { $regex: pattern } }).select('name nameKey active').lean();
  },

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
