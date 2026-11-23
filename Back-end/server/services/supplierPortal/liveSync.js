/**
 * What a LIVE listing's change does to the storefront — and what it must not do.
 *
 *   • Cost / GST change → upsert THE one pending SupplierPriceReview (procurement
 *     decides). Product.price is never written here.
 *   • Availability change (drivesStock) → Product.stock through the existing
 *     product write path (productRepository.update = findByIdAndUpdate, so the
 *     stockRank + back-in-stock hooks run), then the same cache invalidation the
 *     admin product editor does: Redis (+ edge for closed URLs) via
 *     invalidateCache('products') and the Next.js data cache via
 *     revalidateFrontendTags(productTags(product)).
 *   • isActive is never touched: out of stock keeps the page live and indexed.
 */
import productRepository from '../../repositories/productRepository.js';
import listings from '../../repositories/supplierListingRepository.js';
import reviews from '../../repositories/supplierPriceReviewRepository.js';
import { resolveMarginRule } from './marginRules.js';
import { suggestSellingPrice } from '../../utils/supplierPricing.js';
import { invalidateCache } from '../../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../frontendRevalidator.js';
import { productTags } from '../../utils/nextTags.js';

async function loadProduct(productId) {
  const [p] = await productRepository.find({ _id: productId }, { limit: 1, sort: { _id: 1 } });
  return p || null;
}

/**
 * Make the pending review match the listing's CURRENT cost. Loops until the
 * listing's rev is unchanged across the upsert, so with concurrent edits the
 * last writer's cost is what the review ends up holding (whoever wrote the
 * listing last also upserts after it). E11000 on the unique pending index =
 * a parallel insert won; the retry updates that row.
 *
 * @param {object} ownerId
 * @param {object} listingId
 * @param {number} oldCostPaise  the cost before this edit (kept only if this creates the review)
 * @returns {Promise<object|null>} the review row (procurement-only — never send it to a supplier)
 */
export async function syncPriceReview(ownerId, listingId, oldCostPaise) {
  for (let i = 0; i < 6; i += 1) {
     
    const l = await listings.findOwned(ownerId, listingId);
    if (!l || l.status !== 'live' || !l.productId) return null;
     
    const product = await loadProduct(l.productId);
    if (!product) {
      console.warn(`[PARTNER] live listing ${l._id} points at a missing product; no price review raised`);
      return null;
    }
     
    const rule = await resolveMarginRule(product.categories || []);
    const suggestedPrice = suggestSellingPrice({ costPaise: l.costPaise, gstPct: l.gstPct, marginBp: rule.targetBp });
    let review;
    try {
       
      review = await reviews.upsertPending(l._id, {
        set: {
          product: l.productId, supplierAccount: l.supplierAccount,
          newCostPaise: l.costPaise, gstPct: l.gstPct, suggestedPrice, marginBp: rule.targetBp,
        },
        setOnInsert: { oldCostPaise, priceAtRaise: Number(product.price) || 0 },
      });
    } catch (err) {
      if (err?.code === 11000) continue; // lost the insert race — next pass updates the winner's row
      throw err;
    }
     
    const check = await listings.findOwned(ownerId, listingId);
    if (!check || check.rev === l.rev) return review;
  }
  throw new Error('price review did not settle after 6 tries');
}

/** Close the pending review when the listing stops being live. */
export const supersedePriceReview = (listingId) => reviews.supersedePending(listingId);

/**
 * Push a live listing's availability to Product.stock and purge caches.
 * Idempotent (always writes the given value), so a retry after a failure is safe.
 * @returns {Promise<boolean>} true when the product was written
 */
export async function pushStock(listing, availability = listing.availability) {
  if (!listing?.drivesStock || !listing.productId) return false;
  const product = await loadProduct(listing.productId);
  if (!product) {
    console.warn(`[PARTNER] listing ${listing._id} drives stock of a missing product`);
    return false;
  }
  if (product.productType === 'variable' || product.variants?.length) {
    // Parent stock is derived from its variants; one supplier availability cannot set it.
    console.warn(`[PARTNER] listing ${listing._id} drives stock of a variable product; skipped`);
    return false;
  }
  const updated = await productRepository.update(listing.productId, { $set: { stock: availability } });
  if (!updated) return false;
  invalidateCache('products');
  revalidateFrontendTags(productTags(updated));
  return true;
}
