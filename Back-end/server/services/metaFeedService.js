/**
 * Meta (Facebook / Instagram) catalogue feed builder.
 *
 * Emits an RSS 2.0 product feed in Meta's `g:` (Google-compatible) namespace,
 * served at a stable URL that Commerce Manager pulls on a schedule (Data Sources
 * → Scheduled Feed). The feed is the full current truth every run, so a missed
 * pull self-heals on the next one.
 *
 * ── retailer_id continuity (THE critical contract) ────────────────────────────
 * Meta dedupes incoming feed rows against existing catalogue items by their
 * `id` (retailer_id). Our catalogue was originally populated by the "Facebook
 * for WooCommerce" plugin, so to UPDATE those items rather than duplicate them,
 * every `id` here must byte-for-byte match what that plugin wrote.
 *
 * Confirmed from Commerce Manager (2026-07-29):
 *   • simple product   id            = bare Woo post ID        → String(wpId)
 *   • variant          id            = bare Woo variation ID   → String(variant.wpVariationId)
 *   • variable product item_group_id = "wc_post_id_" + Woo post ID
 *
 * Products created natively AFTER the WooCommerce migration have no wpId and were
 * never in the old catalogue, so they get a deterministic `ab_<mongoId>` and are
 * created fresh in Meta. Keeping this scheme in one file makes it auditable
 * against Commerce Manager if the plugin's format is ever re-checked.
 */

import { STOCK_STATUS } from '../utils/stockStatus.js';
import { productContentId, variantContentId, itemGroupId } from '../utils/metaCatalogId.js';
import { escapeXml, stripHtml, priceFields as sharedPriceFields } from '../utils/feedFormat.js';

const MAX_TITLE = 200;        // Meta title hard cap
const MAX_DESCRIPTION = 9000; // Meta description cap is 9999; leave headroom
const MAX_ADDITIONAL_IMAGES = 10;

// ── retailer_id / group_id construction ───────────────────────────────────────
// The scheme lives in utils/metaCatalogId.js so the feed, the client Pixel, and
// server CAPI share ONE definition. Re-exported under the old names for callers
// (and tests) that import them from here.
export { itemGroupId };
export const feedId = productContentId;
export const variantFeedId = variantContentId;

// ── field mapping helpers ─────────────────────────────────────────────────────
// escapeXml / stripHtml / money / priceFields are shared with the Google
// Merchant feed (utils/feedFormat.js) so the two channels can never disagree
// about escaping or about an expired sale price.

/** Meta availability values from our coarse stock status. */
function availability(stock) {
  switch (stock) {
    case STOCK_STATUS.OUT:
      return 'out of stock';
    case STOCK_STATUS.BACKORDER:
      return 'available for order'; // orderable, ships when restocked
    default:
      return 'in stock'; // in, low
  }
}

/**
 * `price` / `sale_price` for a Meta row. The sale-expiry guard lives in the
 * shared helper; here we keep only the two fields Meta rows carry (the helper's
 * numeric `effectiveRupees` is a Google-side validity check).
 */
function priceFields(source) {
  const { price, salePrice } = sharedPriceFields(source);
  return { price, salePrice };
}

function primaryImage(product) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  return (imgs.find((i) => i.isPrimary) || imgs[0] || {}).url || null;
}

function additionalImages(product) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const primary = primaryImage(product);
  return imgs
    .map((i) => i.url)
    .filter((url) => url && url !== primary)
    .slice(0, MAX_ADDITIONAL_IMAGES);
}

function productLink(product, siteUrl) {
  return `${siteUrl}/products/${encodeURIComponent(product.slug)}`;
}

/**
 * Build the neutral row objects for a single product. A simple product yields one
 * row; a variable product with variants yields one row per variant (all sharing
 * item_group_id). A variable product with no variants degrades to a simple row.
 * Rows are plain objects so they can be asserted in tests before serialization.
 */
export function buildItemsForProduct(product, { siteUrl, defaultBrand }) {
  const link = productLink(product, siteUrl);
  const image = primaryImage(product);
  // Meta requires image_link; skip an item entirely if it has no usable image.
  if (!image) return [];

  const extraImages = additionalImages(product);
  const brand = (product.brand && String(product.brand).trim()) || defaultBrand;
  const description =
    (product.shortDescription && stripHtml(product.shortDescription)) ||
    stripHtml(product.description) ||
    product.name;

  const base = {
    link,
    image,
    extraImages,
    brand,
    description: description.slice(0, MAX_DESCRIPTION),
    condition: 'new',
  };

  const variants = Array.isArray(product.variants) ? product.variants : [];

  if (product.productType === 'variable' && variants.length > 0) {
    const group = itemGroupId(product);
    return variants.map((variant) => ({
      ...base,
      id: variantFeedId(product, variant),
      itemGroupId: group,
      title: `${product.name} - ${variant.label}`.slice(0, MAX_TITLE),
      customLabel0: variant.label,
      sku: variant.sku || product.sku || null,
      availability: availability(variant.stock),
      ...priceFields(variant),
    }));
  }

  return [
    {
      ...base,
      id: feedId(product),
      itemGroupId: null,
      title: String(product.name).slice(0, MAX_TITLE),
      customLabel0: null,
      sku: product.sku || null,
      availability: availability(product.stock),
      ...priceFields(product),
    },
  ];
}

function serializeItem(item) {
  const parts = [
    `<g:id>${escapeXml(item.id)}</g:id>`,
    item.itemGroupId ? `<g:item_group_id>${escapeXml(item.itemGroupId)}</g:item_group_id>` : null,
    `<g:title>${escapeXml(item.title)}</g:title>`,
    `<g:description>${escapeXml(item.description)}</g:description>`,
    `<g:link>${escapeXml(item.link)}</g:link>`,
    `<g:image_link>${escapeXml(item.image)}</g:image_link>`,
    ...item.extraImages.map((url) => `<g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`),
    `<g:brand>${escapeXml(item.brand)}</g:brand>`,
    `<g:condition>${item.condition}</g:condition>`,
    `<g:availability>${item.availability}</g:availability>`,
    `<g:price>${escapeXml(item.price)}</g:price>`,
    item.salePrice ? `<g:sale_price>${escapeXml(item.salePrice)}</g:sale_price>` : null,
    // Auto parts rarely carry a GTIN. Emit the SKU as MPN when present, otherwise
    // tell Meta no unique identifier exists (prevents "missing GTIN" warnings).
    item.sku ? `<g:mpn>${escapeXml(item.sku)}</g:mpn>` : `<g:identifier_exists>no</g:identifier_exists>`,
    item.customLabel0 ? `<g:custom_label_0>${escapeXml(item.customLabel0)}</g:custom_label_0>` : null,
  ].filter(Boolean);
  return `    <item>\n      ${parts.join('\n      ')}\n    </item>`;
}

/**
 * Build the full RSS 2.0 feed document from lean product docs.
 * @param {Array} products  from productRepository.findForFeed()
 * @param {object} opts      { siteUrl, companyName, defaultBrand }
 */
export function buildMetaCatalogFeed(products = [], opts = {}) {
  const siteUrl = (opts.siteUrl || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const companyName = opts.companyName || process.env.COMPANY_NAME || 'Autobacs India';
  const defaultBrand = opts.defaultBrand || process.env.META_FEED_DEFAULT_BRAND || companyName;

  const items = [];
  for (const product of products) {
    for (const item of buildItemsForProduct(product, { siteUrl, defaultBrand })) {
      items.push(serializeItem(item));
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '  <channel>\n' +
    `    <title>${escapeXml(companyName)} Product Catalogue</title>\n` +
    `    <link>${escapeXml(siteUrl)}</link>\n` +
    `    <description>${escapeXml(companyName)} product catalogue for Meta Commerce.</description>\n` +
    items.join('\n') +
    (items.length ? '\n' : '') +
    '  </channel>\n' +
    '</rss>\n'
  );
}

export default { buildMetaCatalogFeed, buildItemsForProduct, feedId, variantFeedId, itemGroupId };
