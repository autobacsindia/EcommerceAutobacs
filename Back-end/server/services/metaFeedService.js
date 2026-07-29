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

import { effectivePrice } from './pricingService.js';
import { roundRupees } from '../utils/money.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';

const MAX_TITLE = 200;        // Meta title hard cap
const MAX_DESCRIPTION = 9000; // Meta description cap is 9999; leave headroom
const MAX_ADDITIONAL_IMAGES = 10;

// ── retailer_id / group_id construction (see contract above) ──────────────────
export function feedId(product) {
  return product.wpId != null ? String(product.wpId) : `ab_${product._id}`;
}
export function variantFeedId(product, variant) {
  return variant.wpVariationId != null
    ? String(variant.wpVariationId)
    : `ab_${product._id}_${variant._id}`;
}
export function itemGroupId(product) {
  return product.wpId != null ? `wc_post_id_${product.wpId}` : `ab_${product._id}`;
}

// ── field mapping helpers ─────────────────────────────────────────────────────

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip HTML/entities down to plain text for the feed description. */
function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/** Format a rupee amount the way Meta expects: "45000.00 INR". */
function money(rupees) {
  return `${roundRupees(rupees).toFixed(2)} INR`;
}

/**
 * `price` / `sale_price` from a price source (a product or a variant — both share
 * price/originalPrice/saleEndsAt semantics). Honours the sale-expiry guard via
 * effectivePrice(): if a sale window has passed, the price reverts to
 * originalPrice and no sale_price is emitted, so ads never show a stale discount.
 */
function priceFields(source) {
  const eff = roundRupees(effectivePrice(source));
  const orig = typeof source.originalPrice === 'number' ? roundRupees(source.originalPrice) : null;
  const onSale = orig != null && orig > eff;
  return {
    price: money(onSale ? orig : eff),
    salePrice: onSale ? money(eff) : null,
  };
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
