/**
 * Map WooCommerce product variations → our embedded Product.variants[] subdocs.
 *
 * Shared by the live WP→Mongo sync (services/wordpressSyncService.js) and the
 * one-off backfill (scripts/backfill-variable-products.js) so a variant is shaped
 * identically however it's imported. Pure + deterministic — no I/O.
 *
 * WooCommerce variation price semantics mirror the parent product:
 *   regular_price = list, sale_price = discounted (blank if not on sale),
 *   price        = the effective price WC currently charges.
 * We store `price` as the charged price and set `originalPrice` (the slashed
 * "was") ONLY when genuinely on sale, else null so an off-sale variant clears
 * its stale badge on the next sync.
 */
import { STOCK_STATUS, statusFromQuantity } from './stockStatus.js';

// Minimal HTML-entity decode for attribute option labels (e.g. "A &amp; B").
// Kept dependency-free; the heavier cheerio path lives in the sync service.
export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// WooCommerce variation stock → our coarse status. Honour a managed numeric
// quantity when present, else fall back to the variation's stock_status flag
// (onbackorder → BACKORDER, outofstock → OUT, otherwise IN).
export function variationStock(v) {
  if (v.manage_stock && v.stock_quantity != null) return statusFromQuantity(v.stock_quantity);
  if (v.stock_status === 'outofstock') return STOCK_STATUS.OUT;
  if (v.stock_status === 'onbackorder') return STOCK_STATUS.BACKORDER;
  return STOCK_STATUS.IN;
}

/**
 * @param {Array} wcVariations - raw objects from GET /products/{id}/variations
 * @returns {Array} variant subdocs ready to assign to Product.variants
 */
export function mapVariationsToVariants(wcVariations = []) {
  return wcVariations
    .filter(v => v && v.id)
    .map(v => {
      const attributes = (v.attributes || [])
        .map(a => ({ name: decodeEntities(a.name), option: decodeEntities(a.option) }))
        .filter(a => a.option);
      // Label = the option(s) the shopper picks, e.g. "COROLLA ALTIS 1.8 P" or
      // (multi-attribute) "Black / XL". Fall back to SKU/id so it's never blank.
      const label = attributes.map(a => a.option).join(' / ') || decodeEntities(v.sku) || `Variant ${v.id}`;

      const effective = parseFloat(v.price) || 0;
      const regular   = v.regular_price ? parseFloat(v.regular_price) : 0;
      const sale      = v.sale_price ? parseFloat(v.sale_price) : 0;
      const onSale    = sale > 0 && regular > sale;

      return {
        wpVariationId: v.id,
        label,
        attributes,
        price: effective || regular || 0,
        originalPrice: onSale ? regular : null,
        ...(sale > 0 && { salePrice: sale }),
        stock: variationStock(v),
        ...(v.sku && { sku: v.sku }),
      };
    });
}

/**
 * Preserve existing variant subdoc _ids across a re-import. mapVariationsToVariants
 * produces fresh variants with no _id; assigning them straight into a product would
 * mint NEW ObjectIds every sync, orphaning any cart/order that references a variant
 * by _id. This matches incoming variants to the current ones by wpVariationId and
 * carries the existing _id over, so a re-sync is stable. New variants (no match)
 * keep no _id and Mongoose assigns one once.
 *
 * @param {Array} existingVariants - the product's current variants (may be undefined)
 * @param {Array} newVariants      - freshly mapped variants (from mapVariationsToVariants)
 * @returns {Array} newVariants with _id back-filled from matching existing variants
 */
export function reconcileVariantIds(existingVariants = [], newVariants = []) {
  const byWpId = new Map(
    (existingVariants || [])
      .filter((v) => v && v.wpVariationId != null && v._id != null)
      .map((v) => [String(v.wpVariationId), v._id])
  );
  return newVariants.map((v) => {
    const existingId = v.wpVariationId != null ? byWpId.get(String(v.wpVariationId)) : undefined;
    return existingId ? { ...v, _id: existingId } : v;
  });
}

/**
 * Derive the parent aggregates from variants. The Product pre('validate') hook
 * does this on .save(), but bulk `$set` updates (findByIdAndUpdate) bypass that
 * hook — so importers that use $set must set these explicitly to keep priceMin/
 * priceMax, the back-compat parent `price`, and the coarse parent `stock` correct.
 *
 * @returns {{priceMin:number, priceMax:number, price:number, stock:string}}
 */
export function aggregateFromVariants(variants = []) {
  const prices = variants.map(v => v.price).filter(p => typeof p === 'number' && !Number.isNaN(p));
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  // Parent stock reflects the best availability among variants:
  //   any in/low → IN; else any backorder → BACKORDER (still enquiry-orderable);
  //   else OUT. Collapsing backorder to OUT would wrongly hide a product whose
  //   models can still be ordered via the enquiry flow.
  const anyInStock = variants.some(v => v.stock === STOCK_STATUS.IN || v.stock === STOCK_STATUS.LOW);
  const anyBackorder = variants.some(v => v.stock === STOCK_STATUS.BACKORDER);
  const stock = anyInStock ? STOCK_STATUS.IN : anyBackorder ? STOCK_STATUS.BACKORDER : STOCK_STATUS.OUT;
  return { priceMin, priceMax, price: priceMin, stock };
}

export default mapVariationsToVariants;
