import SupplierEnquiry from '../models/SupplierEnquiry.js';
import Counter from '../models/Counter.js';

/**
 * Supplier enquiries (models/SupplierEnquiry.js). Data access only — who may do
 * what lives in services/supplierEnquiryService.js.
 */
const supplierEnquiryRepository = {
  nextNumber: () => Counter.next('supplier_enquiry'),
  create: async (doc) => (await SupplierEnquiry.create(doc)).toObject(),
  findById: (id) => SupplierEnquiry.findById(id).lean(),
  findByFormKey: (createdBy, formKey) => SupplierEnquiry.findOne({ createdBy, formKey }).lean(),

  /** Keyset page: `query` already carries the "after the cursor" clause. */
  page: (query, { sort, limit }) => SupplierEnquiry.find(query)
    .select('-suppliers.quotes -items.note')
    .sort(sort).limit(limit).lean(),

  /** How many match, counting at most `limit`. */
  count: (query, limit) => SupplierEnquiry.countDocuments(query, { limit, maxTimeMS: 5000 }),

  /**
   * One conditional write: `match` is the compare-and-set (e.g. not closed, same
   * version), so two people saving at once cannot both win. null when it did not match.
   */
  updateWhere: (match, update, opts = {}) => SupplierEnquiry.findOneAndUpdate(match, update, { new: true, ...opts }).lean(),
};

export default supplierEnquiryRepository;
