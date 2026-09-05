/**
 * Google Merchant Center product feed builder.
 *
 * Emits RSS 2.0 in Google's `g:` namespace at a stable URL that Merchant Center
 * pulls on a schedule (Products → Data sources → Scheduled fetch). Like the Meta
 * feed, the document is the full current catalogue every run, so a missed pull
 * self-heals on the next one.
 *
 * ── Why this is a separate service from metaFeedService ──────────────────────
 * The two platforms share a wire format but NOT their rules. Google is the
 * stricter of the pair and disapproves items rather than ignoring fields:
 *   • availability vocabulary is `in_stock` / `out_of_stock` (underscored), and
 *     `backorder`/`preorder` REQUIRE an availability_date we do not have.
 *   • title ≤ 150 chars, description ≤ 5000 (Meta allows 200 / 9999).
 *   • a non-positive price is invalid — the item is rejected, not down-ranked.
 *   • google_product_category / product_type drive classification and bidding.
 * Sharing one parameterised builder would put Google's stricter rules one bad
 * default away from regressing a Meta feed that is live and verified. The parts
 * that are genuinely identical (escaping, plain-texting, sale-expiry-aware
 * pricing) come from utils/feedFormat.js, so they cannot drift.
 *
 * Offer ids come from utils/googleCatalogId.js — the same ids as Meta, on
 * purpose. See that file for the reasoning.
 */

import { STOCK_STATUS } from '../utils/stockStatus.js';
import { escapeXml, stripHtml, priceFields } from '../utils/feedFormat.js';
import {
  googleOfferId,
  googleVariantOfferId,
  googleItemGroupId,
} from '../utils/googleCatalogId.js';

import { resolveVariantImage } from '../utils/variantImage.js';

const MAX_TITLE = 150;         // Google title hard cap
const MAX_DESCRIPTION = 5000;  // Google description hard cap
const MAX_ADDITIONAL_IMAGES = 10;
const MAX_PRODUCT_TYPES = 5;   // Google accepts up to 10; 5 is plenty here

/**
 * Blanket Google product taxonomy value. Every product we sell is an automotive
 * part or accessory, so one accurate broad category beats a per-category mapping
 * table that would rot as the taxonomy changes. Google refines from the title,
 * description and product_type anyway. Override per-deployment if that changes.
 */
const DEFAULT_GOOGLE_CATEGORY = 'Vehicles & Parts > Vehicle Parts & Accessories';

// ── field mapping helpers ─────────────────────────────────────────────────────

/**
 * Google availability from our coarse stock status.
 *
 * BACKORDER maps to `out_of_stock`, NOT `backorder`: Google requires an
 * `availability_date` alongside backorder/preorder, and we hold no restock date
 * to give it. Advertising a backordered item without one risks item disapproval
 * and a "not shippable in the promised window" policy hit. Out-of-stock items
 * stay in the feed (Google keeps their history and re-serves them on restock)
 * and the storefront still takes waitlist sign-ups, so nothing is lost but ad
 * spend we could not have honoured.
 */
function availability(stock) {
  switch (stock) {
    case STOCK_STATUS.OUT:
    case STOCK_STATUS.BACKORDER:
      return 'out_of_stock';
    default:
      return 'in_stock'; // in, low
  }
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
 * Our own taxonomy for `product_type`, from the product's categories. Populated
 * category docs give names; unpopulated ObjectIds are skipped rather than
 * emitted as hex strings.
 */
function productTypes(product) {
  const cats = Array.isArray(product.categories) ? product.categories : [];
  return cats
    .map((c) => (c && typeof c === 'object' ? c.name : null))
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim())
    .slice(0, MAX_PRODUCT_TYPES);
}

/**
 * Build the neutral row objects for a single product. A simple product yields one
 * row; a variable product with variants yields one row per variant (all sharing
 * item_group_id). A variable product with no variants degrades to a simple row.
 * Rows are plain objects so they can be asserted in tests before serialization.
 *
 * Rows are DROPPED (not emitted with placeholder data) when they would be
 * invalid: no image, or a non-positive price. A rejected item is noise in the
 * Merchant Center diagnostics; a silently-wrong item is worse — a ₹0 or ₹2 price
 * can be served as a real Shopping ad and honoured as a real order.
 */
export function buildItemsForProduct(product, { siteUrl, defaultBrand, googleCategory }) {
  const link = productLink(product, siteUrl);
  const image = primaryImage(product);
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
    description: String(description).slice(0, MAX_DESCRIPTION),
    condition: 'new',
    googleCategory,
    productTypes: productTypes(product),
  };

  const variants = Array.isArray(product.variants) ? product.variants : [];

  const rows =
    product.productType === 'variable' && variants.length > 0
      ? variants.map((variant) => {
          const { price, salePrice, effectiveRupees } = priceFields(variant);
          return {
            ...base,
            id: googleVariantOfferId(product, variant),
            itemGroupId: googleItemGroupId(product),
            /*
              Each model is a separate offer and must carry its own photograph.
              Every row previously shipped the parent's primary image — the shape
              that draws Merchant Center "image mismatch" disapprovals, because
              the picture does not depict the offer being sold. A model with no
              photo of its own resolves to the parent image, which is correct:
              that is what its PDP actually shows.
            */
            image: resolveVariantImage(product, variant)?.url || image,
            title: `${product.name} - ${variant.label}`.slice(0, MAX_TITLE),
            sku: variant.sku || product.sku || null,
            availability: availability(variant.stock),
            price,
            salePrice,
            effectiveRupees,
          };
        })
      : [
          (() => {
            const { price, salePrice, effectiveRupees } = priceFields(product);
            return {
              ...base,
              id: googleOfferId(product),
              itemGroupId: null,
              title: String(product.name).slice(0, MAX_TITLE),
              sku: product.sku || null,
              availability: availability(product.stock),
              price,
              salePrice,
              effectiveRupees,
            };
          })(),
        ];

  return rows.filter((row) => row.effectiveRupees > 0);
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
    item.googleCategory
      ? `<g:google_product_category>${escapeXml(item.googleCategory)}</g:google_product_category>`
      : null,
    ...item.productTypes.map((type) => `<g:product_type>${escapeXml(type)}</g:product_type>`),
    // Auto parts rarely carry a GTIN. Emit the SKU as MPN when present (brand +
    // MPN is an accepted identifier pair); otherwise declare that no unique
    // identifier exists, which is what stops Google withholding the item.
    item.sku ? `<g:mpn>${escapeXml(item.sku)}</g:mpn>` : `<g:identifier_exists>no</g:identifier_exists>`,
  ].filter(Boolean);
  return `    <item>\n      ${parts.join('\n      ')}\n    </item>`;
}

/**
 * Build the full RSS 2.0 feed document from lean product docs.
 * @param {Array} products  from productRepository.findForFeed()
 * @param {object} opts     { siteUrl, companyName, defaultBrand, googleCategory }
 */
export function buildGoogleMerchantFeed(products = [], opts = {}) {
  // FEED_SITE_URL lets the feed advertise the CANONICAL storefront origin
  // (https://www.autobacsindia.com) without touching FRONTEND_URL, which also
  // drives CORS and redirects. Merchant Center matches landing pages against the
  // claimed website, so a feed full of apex URLs that 308 to www is an avoidable
  // redirect hop on every crawl and click.
  const siteUrl = (opts.siteUrl || process.env.FEED_SITE_URL || process.env.FRONTEND_URL || '')
    .replace(/\/+$/, '');
  const companyName = opts.companyName || process.env.COMPANY_NAME || 'Autobacs India';
  const defaultBrand =
    opts.defaultBrand || process.env.GOOGLE_FEED_DEFAULT_BRAND || process.env.META_FEED_DEFAULT_BRAND || companyName;
  const googleCategory =
    opts.googleCategory || process.env.GOOGLE_FEED_PRODUCT_CATEGORY || DEFAULT_GOOGLE_CATEGORY;

  const items = [];
  for (const product of products) {
    for (const item of buildItemsForProduct(product, { siteUrl, defaultBrand, googleCategory })) {
      items.push(serializeItem(item));
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '  <channel>\n' +
    `    <title>${escapeXml(companyName)} Product Catalogue</title>\n` +
    `    <link>${escapeXml(siteUrl)}</link>\n` +
    `    <description>${escapeXml(companyName)} product catalogue for Google Merchant Center.</description>\n` +
    items.join('\n') +
    (items.length ? '\n' : '') +
    '  </channel>\n' +
    '</rss>\n'
  );
}

export default { buildGoogleMerchantFeed, buildItemsForProduct };
