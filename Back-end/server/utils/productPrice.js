/**
 * The price a buyer is actually charged for a product or variant right now.
 *
 * Lives in utils rather than in pricingService because campaignService needs it too —
 * to advertise a product's campaign rate on the product page — and pricingService
 * already imports campaignService. Putting it here breaks that cycle rather than
 * relying on ESM hoisting to paper over one.
 *
 * pricingService re-exports it, so every existing `import { effectivePrice } from
 * '../services/pricingService.js'` keeps working unchanged.
 */

/**
 * Authoritative sale-expiry guard: if a product has a time-boxed sale (`saleEndsAt`)
 * that has already passed, the sale price (`price`) is ignored and the effective price
 * reverts UP to `originalPrice`. This holds even in the seconds before the cron sweep
 * normalizes the stored fields, so a sale can never be charged past its end instant.
 * Pre-expiry, or with no sale window, the stored `price` is used unchanged.
 */
export function effectivePrice(product, now = new Date()) {
  if (
    product?.saleEndsAt &&
    now >= new Date(product.saleEndsAt) &&
    typeof product.originalPrice === 'number' &&
    product.originalPrice > product.price
  ) {
    return product.originalPrice;
  }
  return product.price;
}
