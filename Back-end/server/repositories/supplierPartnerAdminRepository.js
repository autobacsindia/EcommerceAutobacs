import SupplierAccount, { SUPPLIER_ACCOUNT_STATUS } from '../models/SupplierAccount.js';
import SupplierListing, { LISTING_STATUS } from '../models/SupplierListing.js';
import SupplierPriceReview, { PRICE_REVIEW_STATUS } from '../models/SupplierPriceReview.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';

/**
 * Procurement's side of Autobacs Partner — data access only. Who may do what,
 * and every money rule, lives in services/procurementPartners/*.
 *
 * Writes that move a status are compare-and-set: the filter names the status
 * (and for listings the `rev`) the caller read, so a concurrent edit or a
 * double-click finds nothing to update and the service answers 409 / idempotent
 * instead of overwriting.
 */

// What procurement's queue rows need — never the password / code / lock fields
// (those are `select: false` on the model anyway).
const ACCOUNT_ROW = 'companyName contactName email phone city status submittedAt reviewedAt reviewedByName supplierId createdAt';
const LISTING_ROW = 'supplierAccount supplierId status rev title brand partNumber costPaise gstPct availability images submittedAt reviewNote productId liveAt editedSinceLive updatedAt';

// Status constants, re-exported so services never import a model (eslint rule).
export { SUPPLIER_ACCOUNT_STATUS, LISTING_STATUS, PRICE_REVIEW_STATUS };

const supplierPartnerAdminRepository = {
  // ── Supplier accounts ────────────────────────────────────────────────────
  accountPage: (query, { sort, limit }) => SupplierAccount.find(query).select(ACCOUNT_ROW).sort(sort).limit(limit).lean(),
  findAccount: (id, { bank = false } = {}) => {
    const q = SupplierAccount.findById(id);
    return (bank ? q.select('+bank.accountNumber') : q).lean();
  },
  findAccountsByIds: (ids) => SupplierAccount.find({ _id: { $in: ids } }).select('companyName status supplierId').lean(),
  /** CAS on status. Returns the updated row, or null if the status had moved on. */
  casAccount: (id, fromStatuses, set, { bumpSession = false } = {}) => SupplierAccount.findOneAndUpdate(
    { _id: id, status: { $in: fromStatuses } },
    { $set: set, ...(bumpSession ? { $inc: { sessionVersion: 1 } } : {}) },
    { new: true },
  ).lean(),
  findAccountBySupplierId: (supplierId) => SupplierAccount.findOne({ supplierId }).select('_id companyName').lean(),
  countAccounts: (status) => SupplierAccount.countDocuments({ status }),

  // ── Listings ─────────────────────────────────────────────────────────────
  listingPage: (query, { sort, limit }) => SupplierListing.find(query).select(LISTING_ROW).sort(sort).limit(limit).lean(),
  findListing: (id) => SupplierListing.findById(id).lean(),
  /** CAS on status AND the rev procurement reviewed. */
  casListing: (id, { statuses, rev }, set) => SupplierListing.findOneAndUpdate(
    { _id: id, status: { $in: statuses }, ...(rev == null ? {} : { rev }) },
    { $set: set },
    { new: true },
  ).lean(),
  /** Another live listing already driving this product's stock? */
  findStockDriver: (productId, exceptListingId) => SupplierListing.findOne({
    productId, drivesStock: true, status: 'live', _id: { $ne: exceptListingId },
  }).select('_id').lean(),
  findLiveListingForProduct: (productId, supplierAccount) => SupplierListing.findOne({ productId, supplierAccount }).select('_id status').lean(),
  findListingsByIds: (ids) => SupplierListing.find({ _id: { $in: ids } }).select('title partNumber supplierAccount costPaise gstPct').lean(),
  countListings: (status) => SupplierListing.countDocuments({ status }),

  // ── Price reviews ────────────────────────────────────────────────────────
  reviewPage: (query, { sort, limit }) => SupplierPriceReview.find(query).sort(sort).limit(limit).lean(),
  findReview: (id) => SupplierPriceReview.findById(id).lean(),
  casReview: (id, fromStatus, set) => SupplierPriceReview.findOneAndUpdate({ _id: id, status: fromStatus }, { $set: set }, { new: true }).lean(),
  countReviews: (status) => SupplierPriceReview.countDocuments({ status }),

  // ── Products (only what this flow writes; the admin product path owns the rest) ──
  /** Minimal view for review screens: name, price, stock, images — never a cost (Product has none). */
  findProducts: (ids) => Product.find({ _id: { $in: ids } })
    .select('name slug sku price originalPrice saleEndsAt stock isActive images categories brand productType')
    .lean(),
  findProduct: (id) => Product.findById(id)
    .select('name slug sku price originalPrice saleEndsAt stock isActive images categories brand productType')
    .lean(),
  findProductBySku: (sku) => Product.findOne({ sku }).select('_id').lean(),
  /** A new Product through the model, so slug, SEO-default and validate hooks run as for an admin create. */
  createProduct: async (doc) => (await Product.create(doc)).toObject(),
  /** Price and/or stock on an existing product. Returns the updated product (or null if it is gone). */
  setProductFields: (id, set) => Product.findOneAndUpdate({ _id: id }, { $set: set }, { new: true })
    .select('name slug price originalPrice stock isActive')
    .lean(),

  findCategories: (ids) => Category.find({ _id: { $in: ids } }).select('name slug').lean(),
};

export default supplierPartnerAdminRepository;
