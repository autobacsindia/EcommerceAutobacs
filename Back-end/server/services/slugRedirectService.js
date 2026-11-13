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

export async function getSlugRedirectMap() {
  const [products, categories, brands, articles] = await Promise.all([
    productRepository.findSlugsForRedirects(),
    categoryRepository.find({ isActive: true }).select(select).lean(),
    brandRepository.find({ isActive: true }).select(select).lean(),
    // Only blog posts are served at /blog/<slug>; other article types live elsewhere.
    articleRepository.find({ status: 'published', type: 'blog' }).select(select).lean(),
  ]);
  return {
    products: buildSlugMap(products),
    categories: buildSlugMap(categories),
    brands: buildSlugMap(brands),
    articles: buildSlugMap(articles),
  };
}

export default { getSlugRedirectMap, buildSlugMap };
