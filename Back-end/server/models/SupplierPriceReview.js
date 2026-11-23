import mongoose from 'mongoose';

/**
 * A supplier changed the cost of a LIVE product → procurement decides the new
 * selling price. A cost change NEVER changes Product.price by itself.
 *
 *   pending    → waiting for procurement. At most ONE per listing (unique partial
 *                index): a second cost change before a decision updates the same
 *                pending row (newCostPaise, suggestedPrice) instead of stacking.
 *   applied    → procurement set Product.price = decidedPrice (cache purged).
 *   kept       → procurement kept the current price.
 *   superseded → the listing stopped being live before a decision.
 *
 * Applied + kept rows are the product's cost/price history.
 * Procurement-only. Never returned to a supplier or a customer.
 */
export const PRICE_REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  APPLIED: 'applied',
  KEPT: 'kept',
  SUPERSEDED: 'superseded',
});

const SupplierPriceReviewSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierListing', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    supplierAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierAccount', required: true },
    status: { type: String, enum: Object.values(PRICE_REVIEW_STATUS), default: PRICE_REVIEW_STATUS.PENDING },

    oldCostPaise: { type: Number, required: true, min: 0 },
    newCostPaise: { type: Number, required: true, min: 1 },
    gstPct: { type: Number, required: true },
    priceAtRaise: { type: Number, required: true, min: 0 },   // Product.price (rupees, incl. GST) then
    suggestedPrice: { type: Number, required: true, min: 0 }, // from the margin rule, rupees incl. GST
    marginBp: { type: Number, required: true },               // the rule used for the suggestion

    decidedPrice: { type: Number, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

SupplierPriceReviewSchema.index(
  { listing: 1 },
  { unique: true, name: 'price_review_one_pending', partialFilterExpression: { status: 'pending' } }
);
SupplierPriceReviewSchema.index({ status: 1, createdAt: 1, _id: 1 }, { name: 'price_review_status_created' });
SupplierPriceReviewSchema.index({ product: 1, createdAt: -1, _id: -1 }, { name: 'price_review_product_history' });

export default mongoose.models.SupplierPriceReview || mongoose.model('SupplierPriceReview', SupplierPriceReviewSchema);
