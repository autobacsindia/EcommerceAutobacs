/**
 * Old URL → new URL map for renamed slugs.
 *
 * Every product, category, brand and blog post keeps the slugs it used to have
 * in `previousSlugs` (models/plugins/slugHistory.js). This turns them into the
 * one map the frontend middleware needs to answer an old URL with a 301:
 *
 *   { products:   { "old-slug": "new-slug", … },
 *     categories: { … }, brands: { … }, articles: { … } }
 *
 * Rules:
 *   - Only PUBLIC targets (active product/category/brand, published blog post).
 *     A redirect to a draft would leak its URL and land on a 404 anyway.
 *   - A slug that is some OTHER document's current slug is never redirected:
 *     the live page at that URL wins. (Rename A "x"→"y", then give B "x".)
 *   - An old slug claimed by two documents is dropped rather than guessed.
 */
import productRepository from '../repositories/productRepository.js';
import categoryRepository from '../repositories/categoryRepository.js';
import brandRepository from '../repositories/brandRepository.js';
import articleRepository from '../repositories/articleRepository.js';
import redirectRepository from '../repositories/redirectRepository.js';
import vehicleRepository from '../repositories/vehicleRepository.js';
import { finalizePathMap } from '../utils/redirectPaths.js';

/**
 * Build `{ oldSlug: currentSlug }` from `[{ slug, previousSlugs }]`. Pure.
 * @param {Array<{slug?: string, previousSlugs?: string[]}>} docs
 * @returns {Record<string, string>}
 */
export function buildSlugMap(docs) {
  const live = new Set(docs.map((d) => d.slug).filter(Boolean));
  const map = new Map();
  const ambiguous = new Set();
  for (const doc of docs) {
    if (!doc.slug || !Array.isArray(doc.previousSlugs)) continue;
    for (const old of doc.previousSlugs) {
      if (!old || old === doc.slug || live.has(old)) continue;
      if (map.has(old) && map.get(old) !== doc.slug) ambiguous.add(old);
      map.set(old, doc.slug);
    }
  }
  for (const old of ambiguous) map.delete(old);
  return Object.fromEntries(map);
}

const select = 'slug previousSlugs';
const SECTION_PREFIX = { products: '/products/', categories: '/categories/', brands: '/brands/', articles: '/blog/' };
const MAX_ROWS = 50000;

/**
 * Whole-path redirects: `{ "/products/old": "/categories/dash-cams", "/model/x": null }`.
 * Pure, so the rules are tested without a database.
 *
 *   - A DELETED product (soft-deleted, `deletedAt` set) goes to its first active
 *     category, so its old URL keeps its visitors instead of 404ing.
 *   - A row in the redirect table (admin choice, reviewed legacy map) overrides that.
 *   - A path that is a live page (product, category, brand, blog post, vehicle)
 *     is never redirected, and chains collapse to one hop (utils/redirectPaths.js).
 */
export function buildPathMap({ deletedProducts = [], rows = [], categoryById = new Map(), live, renames }) {
  const paths = new Map();
  for (const p of deletedProducts) {
    if (!p?.slug) continue;
    const cat = (p.categories || []).map((id) => categoryById.get(String(id))).find(Boolean);
    if (!cat) continue;
    for (const slug of [p.slug, ...(p.previousSlugs || [])]) {
      if (slug) paths.set(`/products/${String(slug).toLowerCase()}`, `/categories/${cat}`);
    }
  }
  for (const r of rows) {
    if (r?.fromPath) paths.set(r.fromPath, r.toPath ?? null);
  }
  const rename = (path) => {
    for (const [key, prefix] of Object.entries(SECTION_PREFIX)) {
      if (!path.startsWith(prefix)) continue;
      const next = renames[key]?.[path.slice(prefix.length)];
      return next ? `${prefix}${next}` : null;
    }
    return null;
  };
  return finalizePathMap(paths, { isLive: (path) => live.has(path), rename });
}

export async function getSlugRedirectMap() {
  const [products, categories, brands, articles, vehicles, deletedProducts, rows] = await Promise.all([
    productRepository.findSlugsForRedirects(),
    categoryRepository.find({ isActive: true }).select(select).lean(),
    brandRepository.find({ isActive: true }).select(select).lean(),
    articleRepository.find({ status: 'published', type: 'blog' }).select(select).lean(),
    vehicleRepository.find({ isActive: true }).select('slug').limit(MAX_ROWS).lean(),
    productRepository.findDeletedForRedirects(),
    redirectRepository.findAllForMap(MAX_ROWS),
  ]);

  const renames = {
    products: buildSlugMap(products),
    categories: buildSlugMap(categories),
    brands: buildSlugMap(brands),
    articles: buildSlugMap(articles),
  };
  const slugsOf = (docs) => docs.map((d) => d.slug).filter(Boolean);
  const live = new Set([
    ...slugsOf(products).map((s) => `/products/${s}`.toLowerCase()),
    ...slugsOf(categories).map((s) => `/categories/${s}`.toLowerCase()),
    ...slugsOf(brands).map((s) => `/brands/${s}`.toLowerCase()),
    ...slugsOf(articles).map((s) => `/blog/${s}`.toLowerCase()),
    ...slugsOf(vehicles).map((s) => `/model/${s}`.toLowerCase()),
  ]);
  const categoryById = new Map(categories.filter((c) => c.slug).map((c) => [String(c._id), c.slug]));

  return {
    ...renames,
    paths: buildPathMap({ deletedProducts, rows, categoryById, live, renames }),
    // Current category/brand slugs: lets the edge send /collections/<x> and
    // /product-brand/<x> to a page that exists, without a lookup per request.
    live: { categories: slugsOf(categories), brands: slugsOf(brands) },
  };
}

export default { getSlugRedirectMap, buildSlugMap, buildPathMap };
