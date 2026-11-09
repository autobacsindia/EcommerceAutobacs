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
import { toStoredSetting, FESTIVAL_SETTING_MODE } from '../utils/festivalOffer.js';
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

/** One keyset page; `nextCursor` is null on the last page. */
export async function listFestivalOfferExceptions({ mode = null, cursor = null, limit = 50 } = {}) {
  const pageSize = Math.min(Math.max(1, limit), MAX_EXCEPTIONS_PAGE);
  const rows = await productRepository.findFestivalOfferExceptions({ mode, afterId: cursor, limit: pageSize + 1 });
  const hasMore = rows.length > pageSize;
  const products = hasMore ? rows.slice(0, pageSize) : rows;
  return { products, nextCursor: hasMore ? String(products[products.length - 1]._id) : null };
}

export default { setProductsFestivalOffer, listFestivalOfferExceptions, MAX_BULK_PRODUCTS, MAX_EXCEPTIONS_PAGE };
