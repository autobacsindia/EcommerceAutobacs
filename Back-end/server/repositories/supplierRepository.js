import Supplier from '../models/Supplier.js';

/**
 * Suppliers (models/Supplier.js). Data access only — who may do what lives in
 * services/supplierService.js. The account number is never selected unless a
 * caller asks for it with `withAccount`.
 */
const withAccount = (q, yes) => (yes ? q.select('+payment.accountNumber') : q);

const supplierRepository = {
  create: async (doc) => (await Supplier.create(doc)).toObject(),
  findById: (id, { account = false } = {}) => withAccount(Supplier.findById(id), account).lean(),

  /** Save changes through the document so the account-number setter encrypts. */
  update: async (id, set) => {
    const doc = await Supplier.findById(id).select('+payment.accountNumber');
    if (!doc) return null;
    doc.set(set);
    await doc.save();
    return doc.toObject();
  },

  /** Keyset page by name (index supplier_active_name / supplier_name). */
  page: ({ prefix = '', active = null, after = '', limit }) => {
    const query = {};
    if (active != null) query.active = active;
    const range = {};
    if (prefix) {
      // Prefix range on nameKey — an index scan, never a collection scan.
      range.$gte = prefix;
      range.$lt = `${prefix}￿`;
    }
    if (after) range.$gt = after;
    if (Object.keys(range).length) query.nameKey = range;
    return Supplier.find(query).sort({ nameKey: 1 }).limit(limit).lean();
  },
};

export default supplierRepository;
