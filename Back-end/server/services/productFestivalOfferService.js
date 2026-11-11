/**
 * Per-product Diwali offer setting — the only write path for
 * Product.festivalOfferSetting. One product or many go through the same code, so a bulk
 * change gets the same validation, cache purge and audit as a single one.
 *
 * The price itself is never computed here: utils/festivalOffer.js owns that, and
 * pricingService reads the setting from the database on every quote, so a change is
 * charged correctly on the next quote even if a cache purge is still in flight.
 */

import productRepository from '../repositories/productRepository.js';
import festivalOfferRepository from '../repositories/festivalOfferRepository.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from './frontendRevalidator.js';
import auditLogger from './auditLogger.js';
import { productBulkTags } from '../utils/nextTags.js';
import { toStoredSetting, toStoredVariantSetting, FESTIVAL_SETTING_MODE } from '../utils/festivalOffer.js';
import AppError from '../utils/AppError.js';

export const MAX_BULK_PRODUCTS = 200;
export const MAX_EXCEPTIONS_PAGE = 100;

const describe = (setting) => (setting
  ? { mode: setting.mode, ...(setting.percent != null && { percent: setting.percent }) }
  : { mode: FESTIVAL_SETTING_MODE.AUTO });

const sameSetting = (a, b) => (a?.mode ?? null) === (b?.mode ?? null) && (a?.percent ?? null) === (b?.percent ?? null);

/**
 * @returns {{ requested, updated, unchanged, notFound: string[] }}
 */
export async function setProductsFestivalOffer(req, { productIds, mode, percent }) {
  const ids = [...new Set(productIds.map(String))];
  if (ids.length > MAX_BULK_PRODUCTS) throw new AppError(`Choose at most ${MAX_BULK_PRODUCTS} products at a time`, 400, { expose: true });

  let stored;
  try {
    stored = toStoredSetting(mode, percent);
  } catch {
    throw new AppError('Invalid Diwali offer setting', 400, { expose: true });
  }

  const products = await productRepository.findForFestivalOfferChange(ids);
  const foundIds = new Set(products.map((p) => String(p._id)));
  const notFound = ids.filter((id) => !foundIds.has(id));

  // Only real changes are written, purged and audited, so a repeat click is a no-op.
  const changed = products.filter((p) => !sameSetting(p.festivalOfferSetting, stored));
  if (changed.length === 0) {
    return { requested: ids.length, updated: 0, unchanged: products.length, notFound };
  }

  const updated = await productRepository.setFestivalOfferSetting(changed.map((p) => p._id), stored);
  await festivalOfferRepository.touchProductSettings();

  // Stale storefront prices are a trust problem, so purge in the same operation.
  invalidateCache('products');
  revalidateFrontendTags(productBulkTags(changed));

  await auditLogger.logAction(
    req,
    'FESTIVAL_OFFER_PRODUCT_SETTING',
    'Product',
    changed.length === 1 ? changed[0]._id : null,
    {
      to: describe(stored),
      changes: changed.map((p) => ({ product: String(p._id), name: p.name, from: describe(p.festivalOfferSetting) })),
    },
  );

  return { requested: ids.length, updated, unchanged: products.length - changed.length, notFound };
}

const sameEntries = (a = [], b = []) => {
  const key = (list) => JSON.stringify(
    (list || []).map((e) => [String(e.variantId), e.mode, e.percent ?? null]).sort(),
  );
  return key(a) === key(b);
};

/**
 * The product editor's Diwali box: the product-level choice plus one choice per model,
 * saved together. `variants` lists only the models the admin touched; any model left
 * out — or sent as 'inherit' — follows the product ("same as product").
 *
 * @param {{ mode, percent?, variants?: Array<{ variantId, mode, percent? }> }} input
 * @returns {{ updated: boolean, festivalOfferSetting, festivalOfferVariantSettings }}
 */
export async function setProductFestivalOfferFull(req, productId, { mode, percent, variants = [] }) {
  let stored;
  const entries = [];
  try {
    stored = toStoredSetting(mode, percent);
    for (const v of variants) {
      const s = toStoredVariantSetting(v.mode, v.percent);
      if (s) entries.push({ variantId: String(v.variantId), ...s });
    }
  } catch {
    throw new AppError('Invalid Diwali offer setting', 400, { expose: true });
  }

  const product = await productRepository.findForFestivalOfferEdit(productId);
  if (!product) throw new AppError('Product not found', 404, { expose: true });

  const seen = new Set();
  for (const v of variants) {
    const id = String(v.variantId);
    if (seen.has(id)) throw new AppError('Each model can only be set once', 400, { expose: true });
    seen.add(id);
  }
  const modelIds = new Set((product.variants || []).map((v) => String(v._id)));
  if (entries.length && product.productType !== 'variable') {
    throw new AppError('This product has no models', 400, { expose: true });
  }
  if (variants.some((v) => !modelIds.has(String(v.variantId)))) {
    throw new AppError('A model was changed or removed — reload the page and try again', 409, { expose: true });
  }

  const before = { setting: product.festivalOfferSetting || null, variants: product.festivalOfferVariantSettings || [] };
  if (sameSetting(before.setting, stored) && sameEntries(before.variants, entries)) {
    return { updated: false, festivalOfferSetting: stored, festivalOfferVariantSettings: entries };
  }

  const matched = await productRepository.setFestivalOfferFull(product._id, stored, entries);
  if (!matched) throw new AppError('A model was changed or removed — reload the page and try again', 409, { expose: true });
  await festivalOfferRepository.touchProductSettings();

  // Same purge as the single-product setting: Redis + Cloudflare (invalidateCache) and
  // the Next.js tags. Pricing reads Mongo directly, so it is right even mid-purge.
  invalidateCache('products');
  revalidateFrontendTags(productBulkTags([product]));

  const labels = new Map((product.variants || []).map((v) => [String(v._id), v.label]));
  const describeEntries = (list) => (list || []).map((e) => ({
    model: labels.get(String(e.variantId)) || String(e.variantId),
    mode: e.mode,
    ...(e.percent != null && { percent: e.percent }),
  }));
  await auditLogger.logAction(req, 'FESTIVAL_OFFER_PRODUCT_SETTING', 'Product', product._id, {
    name: product.name,
    from: { ...describe(before.setting), models: describeEntries(before.variants) },
    to: { ...describe(stored), models: describeEntries(entries) },
  });

  return { updated: true, festivalOfferSetting: stored, festivalOfferVariantSettings: entries };
}

/** One keyset page; `nextCursor` is null on the last page. */
export async function listFestivalOfferExceptions({ mode = null, cursor = null, limit = 50 } = {}) {
  const pageSize = Math.min(Math.max(1, limit), MAX_EXCEPTIONS_PAGE);
  const rows = await productRepository.findFestivalOfferExceptions({ mode, afterId: cursor, limit: pageSize + 1 });
  const hasMore = rows.length > pageSize;
  const products = hasMore ? rows.slice(0, pageSize) : rows;
  return { products, nextCursor: hasMore ? String(products[products.length - 1]._id) : null };
}

export default { setProductsFestivalOffer, setProductFestivalOfferFull, listFestivalOfferExceptions, MAX_BULK_PRODUCTS, MAX_EXCEPTIONS_PAGE };
