import SupplierListing, { LISTING_STATUS, LISTING_STATUS_VALUES } from '../models/SupplierListing.js';

/**
 * Supplier listings (models/SupplierListing.js). Data access only.
 *
 * EVERY supplier-facing method takes the owner id and puts `supplierAccount`
 * first in the filter — that filter IS the ownership check (another supplier's
 * listing simply does not match → 404, never 403, so ids cannot be probed).
 */
export { LISTING_STATUS, LISTING_STATUS_VALUES };

const supplierListingRepository = {
  create: (data) => SupplierListing.create(data),

  findOwned: (ownerId, id) => SupplierListing.findOne({ supplierAccount: ownerId, _id: id }).lean(),

  /** Keyset page, newest-updated first. `after` = { updatedAt, id } of the last row seen. */
  listOwned: (ownerId, { status = null, after = null, limit }) => {
    const filter = { supplierAccount: ownerId };
    if (status) filter.status = status;
    if (after) {
      filter.$or = [
        { updatedAt: { $lt: after.updatedAt } },
        { updatedAt: after.updatedAt, _id: { $lt: after.id } },
      ];
    }
    return SupplierListing.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  },

  /** Compare-and-set update of an owned listing. null when the filter no longer matches. */
  updateOwned: (ownerId, id, where, update) => SupplierListing.findOneAndUpdate(
    { supplierAccount: ownerId, _id: id, ...where },
    update,
    { new: true, runValidators: true },
  ).lean(),

  // Exposed for the optimization pass / tests (explain on the list query).
  model: SupplierListing,
};

export default supplierListingRepository;
