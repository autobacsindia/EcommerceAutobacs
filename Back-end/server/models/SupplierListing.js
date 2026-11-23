import mongoose from 'mongoose';
import { SUPPLIER_AVAILABILITY, GST_RATES, MAX_LISTING_IMAGES, MAX_COST_PAISE } from '../config/supplierPortal.js';

/**
 * One product as a SUPPLIER offers it — their own words, photos, cost and stock.
 *
 * THE SAFETY LINE: this record is never read by any public/customer code path.
 * It reaches the storefront only through procurement approval, which creates or
 * updates a `Product` (services/... procurement side). The supplier's cost lives
 * ONLY here and in SupplierPriceReview — never on `Product` — so no product API,
 * cache entry or Atlas Search index can ever carry it.
 *
 * Status
 *   draft             → being written by the supplier; procurement does not see it.
 *   submitted         → waiting for procurement.
 *   changes_requested → procurement asked for a fix (reviewNote); supplier edits + resubmits.
 *   live              → approved; `productId` is the live product.
 *   rejected          → final.
 *   withdrawn         → supplier stopped selling it (a live product's stock goes 'out').
 *
 * `rev` is bumped on EVERY supplier edit. Procurement approval must name the rev
 * it reviewed (compare-and-set), so a supplier edit made while procurement was
 * looking can never be approved unseen.
 */
export const LISTING_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'changes_requested',
  LIVE: 'live',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
});
export const LISTING_STATUS_VALUES = Object.freeze(Object.values(LISTING_STATUS));

const ImageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 300 }, // private storage key
    // Which store holds it (see SupplierAccount DocFileSchema). Missing = cloudinary.
    provider: { type: String, enum: ['r2', 'cloudinary'] },
    contentType: { type: String, default: '', maxlength: 80 },
  },
  { _id: false }
);

const SpecSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    value: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const SupplierListingSchema = new mongoose.Schema(
  {
    supplierAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierAccount', required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },

    status: { type: String, enum: LISTING_STATUS_VALUES, default: LISTING_STATUS.DRAFT },
    rev: { type: Number, default: 0 },

    // What the supplier wrote.
    title: { type: String, required: true, trim: true, maxlength: 200 },
    brand: { type: String, default: '', trim: true, maxlength: 80 },
    partNumber: { type: String, default: '', trim: true, maxlength: 80 },
    description: { type: String, default: '', trim: true, maxlength: 4000 },
    fits: { type: String, default: '', trim: true, maxlength: 500 }, // "Creta 2020+, Seltos"
    categoryHint: { type: String, default: '', trim: true, maxlength: 80 },
    specs: { type: [SpecSchema], default: [], validate: (v) => v.length <= 30 },
    images: { type: [ImageSchema], default: [], validate: (v) => v.length <= MAX_LISTING_IMAGES },

    // The supplier's own price per unit, WITHOUT GST, in whole paise.
    costPaise: { type: Number, required: true, min: 1, max: MAX_COST_PAISE, validate: Number.isInteger },
    gstPct: { type: Number, required: true, enum: GST_RATES },
    availability: { type: String, enum: SUPPLIER_AVAILABILITY, default: 'in' },
    availabilityAt: { type: Date, default: Date.now },
    dispatchDays: { type: Number, default: 2, min: 0, max: 60, validate: Number.isInteger },
    costChangedAt: { type: Date, default: null },

    // Set by procurement.
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    // This listing's availability drives Product.stock (one source per product in v1).
    drivesStock: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 1000 },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: '' },
    liveAt: { type: Date, default: null },
    // Supplier edited title/photos/specs after going live — procurement should look.
    editedSinceLive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Supplier's own list, newest first — keyset on (updatedAt, _id). Every supplier
// query starts with supplierAccount: that IS the ownership filter.
SupplierListingSchema.index({ supplierAccount: 1, updatedAt: -1, _id: -1 }, { name: 'listing_owner_updated' });
// Procurement queue: by status, oldest submission first.
SupplierListingSchema.index({ status: 1, submittedAt: 1, _id: 1 }, { name: 'listing_status_submitted' });
// One listing per supplier per live product; also "who supplies this product".
SupplierListingSchema.index(
  { productId: 1, supplierAccount: 1 },
  { unique: true, name: 'listing_product_supplier', partialFilterExpression: { productId: { $type: 'objectId' } } }
);

export default mongoose.models.SupplierListing || mongoose.model('SupplierListing', SupplierListingSchema);
