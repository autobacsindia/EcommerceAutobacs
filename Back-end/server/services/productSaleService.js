/**
 * Product sale-expiry sweep.
 *
 * Time-boxed sales (Product.saleEndsAt) are authoritative at READ time via
 * pricingService.effectivePrice — nobody is ever charged a sale price past its
 * end instant. This sweep is the WRITE-side normalizer: it walks products whose
 * sale window has closed and reverts the stored fields so the rest of the system
 * (price sort/filter indexes, Elasticsearch, the slashed-price UI) reflects the
 * post-sale reality.
 *
 * For each expired sale:
 *   price        ← originalPrice   (charged price reverts UP to the MRP)
 *   originalPrice → unset          (no more slash)
 *   saleEndsAt    → unset          (no more countdown)
 *
 * Idempotent and self-healing: products are only matched while saleEndsAt is
 * still set, so a re-run (or a run after a missed tick / redeploy) is a no-op
 * for already-reverted products. Per-product updates go through the repository
 * so each one triggers the ES re-sync hook; cache is invalidated once at the end.
 */

import productRepository from '../repositories/productRepository.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from './frontendRevalidator.js';

/**
 * Run one sweep. Never throws — returns a summary for observability/logging.
 * @param {Date} now  injectable clock (tests)
 * @returns {Promise<{ reverted: number, failed: number }>}
 */
export async function expireEndedSales(now = new Date()) {
  let reverted = 0;
  let failed = 0;

  const expired = await productRepository.findExpiredSales(now);
  if (expired.length === 0) return { reverted, failed };

  for (const p of expired) {
    // Revert target: the original (MRP) price. Guard against malformed data —
    // if originalPrice is missing or not actually higher, just clear the markers
    // by reverting to the current price (no surprise price change).
    const revertPrice =
      typeof p.originalPrice === 'number' && p.originalPrice > p.price
        ? p.originalPrice
        : p.price;
    try {
      await productRepository.revertExpiredSale(p._id, revertPrice);
      reverted += 1;
    } catch (err) {
      failed += 1;
      console.error(`[ProductSale] Failed to revert expired sale for ${p._id}:`, err.message);
    }
  }

  if (reverted > 0) {
    invalidateCache('products');
    // A sweep can revert many products at once; refresh the home featured grid
    // coarsely rather than enumerating every affected slug.
    revalidateFrontendTags(['home:products']);
    console.log(`[ProductSale] Reverted ${reverted} expired sale(s)` + (failed ? `, ${failed} failed` : ''));
  }

  return { reverted, failed };
}

export default { expireEndedSales };
