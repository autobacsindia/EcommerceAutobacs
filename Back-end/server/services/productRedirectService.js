/**
 * Where a removed product's URL sends people — the admin's answer to "this
 * product is gone; where should its old link go?".
 *
 * Stored as rows in the redirect table (models/Redirect.js), one per URL the
 * product ever had (current slug + slug history), so an old link answers in ONE
 * hop. Served to the edge by GET /redirects/slugs; nothing reads it per request.
 *
 * No choice (null) removes the product's rows. A deleted product then falls back
 * to its own category (services/slugRedirectService.js buildPathMap); a merely
 * switched-off product 404s, as before, until it is switched back on.
 *
 * A row for a product that is live again is ignored by the map (a live page
 * always wins), so switching a product back on needs no clean-up to be safe.
 */
import productRepository from '../repositories/productRepository.js';
import categoryRepository from '../repositories/categoryRepository.js';
import redirectRepository from '../repositories/redirectRepository.js';
import AppError from '../utils/AppError.js';
import { normalizeTarget } from '../utils/redirectPaths.js';

const TARGET_RE = /^\/(products|categories)\/([a-z0-9][a-z0-9-]*)$/;

/**
 * Validate an admin-chosen target. Returns the normalised path, or null for
 * "no choice". Throws AppError(400) for anything that is not a live product or
 * category of ours — a redirect into a dead page is just a slower 404.
 */
export async function validateRedirectTarget(input, { selfSlug } = {}) {
  if (input === undefined || input === null || (typeof input === 'string' && !input.trim())) return null;
  const path = normalizeTarget(input);
  const m = path && TARGET_RE.exec(path);
  if (!m) throw new AppError('Pick a product or a category for the old link', 400, { expose: true });
  const [, kind, slug] = m;
  if (kind === 'products') {
    if (slug === selfSlug) throw new AppError('A product cannot redirect to itself', 400, { expose: true });
    const live = await productRepository.existsLiveSlug(slug);
    if (!live) throw new AppError('That product is not live on the website', 400, { expose: true });
  } else {
    const live = await categoryRepository.findOne({ slug, isActive: true }).select('_id').lean();
    if (!live) throw new AppError('That category is not live on the website', 400, { expose: true });
  }
  return path;
}

/** Every storefront path this product has answered on. */
export function productPaths(product) {
  const slugs = [product?.slug, ...(product?.previousSlugs || [])].filter(Boolean);
  return [...new Set(slugs.map((s) => `/products/${String(s).toLowerCase()}`))];
}

/**
 * Save (or clear, when `target` is null) the redirect for a product's old URLs.
 * Idempotent: the same call twice leaves the same rows.
 */
export async function setProductRedirect(product, target, userId) {
  const fromPaths = productPaths(product);
  if (!fromPaths.length) return { saved: 0 };
  if (target === null) {
    await redirectRepository.deleteByPaths(fromPaths, 'product');
    return { saved: 0 };
  }
  await redirectRepository.upsertMany(fromPaths, {
    toPath: target,
    source: 'product',
    note: `Product: ${String(product.name || '').slice(0, 200)}`,
    createdBy: userId,
  });
  return { saved: fromPaths.length };
}

/** The target currently stored for this product, or null. */
export async function getProductRedirect(product) {
  const [fromPath] = productPaths(product);
  if (!fromPath) return null;
  const row = await redirectRepository.findOneByPath(fromPath);
  return row?.toPath ?? null;
}
