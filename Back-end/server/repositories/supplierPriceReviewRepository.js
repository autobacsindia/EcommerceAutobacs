import SupplierPriceReview, { PRICE_REVIEW_STATUS } from '../models/SupplierPriceReview.js';

/**
 * Supplier price reviews (models/SupplierPriceReview.js). Data access only.
 * Procurement-only data: nothing here is ever returned to a supplier.
 */
export { PRICE_REVIEW_STATUS };

const supplierPriceReviewRepository = {
  /**
   * Insert-or-update THE pending review for a listing. The unique partial index
   * `price_review_one_pending` makes this race-safe: two concurrent upserts can
   * both miss and both insert, and the loser gets E11000 — the caller retries,
   * and the retry matches the winner's row and updates it.
   */
  upsertPending: (listingId, { set, setOnInsert }) => SupplierPriceReview.findOneAndUpdate(
    { listing: listingId, status: PRICE_REVIEW_STATUS.PENDING },
    { $set: set, $setOnInsert: { listing: listingId, status: PRICE_REVIEW_STATUS.PENDING, ...setOnInsert } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean(),

  /** The listing stopped being live (withdrawn) before procurement decided. */
  supersedePending: (listingId) => SupplierPriceReview.updateOne(
    { listing: listingId, status: PRICE_REVIEW_STATUS.PENDING },
    { $set: { status: PRICE_REVIEW_STATUS.SUPERSEDED, note: 'Supplier withdrew the listing' } },
  ),

  findPending: (listingId) => SupplierPriceReview.findOne({ listing: listingId, status: PRICE_REVIEW_STATUS.PENDING }).lean(),
};

export default supplierPriceReviewRepository;
