/**
 * Next.js Data Cache tag builders — the single source of truth for which tags a
 * write path hands to services/frontendRevalidator.js.
 *
 * Why this file exists: the tags were previously inlined per controller, which
 * let them drift apart. Two classes of bug came out of that drift:
 *
 *   1. A frontend page tagged its fetch with a name no producer could emit (the
 *      catalog listing used the bare 'products'; the revalidator's allowlist only
 *      passes `home: product: category: nav: seo: blog: careers:` prefixes), so
 *      the page served stale until its `revalidate` window expired.
 *   2. Bulk paths emitted only the coarse collection tag and skipped the
 *      per-entity tag, leaving every edited detail page stale.
 *
 * Ordering contract: COARSE TAGS FIRST. The revalidator sends tags in batches of
 * 20 and stops at a MAX_TOTAL_TAGS ceiling, so a bulk write with hundreds of
 * slugs must not push the collection-level tags past that ceiling.
 *
 * Every tag returned here must keep an allowlisted prefix — both the revalidator
 * and the frontend /api/revalidate route drop anything else silently.
 */

/** Coarse tags refreshed by ANY product write: home featured grid + /products. */
const PRODUCT_COLLECTION_TAGS = ['home:products', 'product:list'];

/** Coarse tags refreshed by ANY category write: home grid, nav menu, /categories. */
const CATEGORY_COLLECTION_TAGS = ['home:categories', 'nav:categories', 'category:list'];

/**
 * Tags for a product write.
 * @param {{slug?: string}|null} product  the written product (post-write doc)
 */
export const productTags = (product) => [
  ...PRODUCT_COLLECTION_TAGS,
  ...(product?.slug ? [`product:${product.slug}`] : []),
];

/**
 * Tags for a bulk product write. Collection tags first, then one PDP tag per
 * affected slug — the revalidator batches these across several requests and
 * drops only the tail if the total exceeds its ceiling.
 * @param {Array<{slug?: string}>} products
 */
export const productBulkTags = (products = []) => [
  ...PRODUCT_COLLECTION_TAGS,
  ...products.map((p) => p?.slug).filter(Boolean).map((slug) => `product:${slug}`),
];

/**
 * Tags for a category write.
 * @param {{slug?: string}|null} category
 */
export const categoryTags = (category) => [
  ...CATEGORY_COLLECTION_TAGS,
  ...(category?.slug ? [`category:${category.slug}`] : []),
];

/** Tags for a careers/JobPosting write — /careers renders one server-fetched list. */
export const careersTags = () => ['careers:list'];

/**
 * Tags for a promo-banner write.
 *
 * One tag, because there is one banner: it is fetched server-side in the root
 * layout and on the home page, and both fetches carry this single tag. Any write
 * — create, edit, toggle, delete — refreshes every storefront page that holds it.
 */
export const promoBannerTags = () => ['promo:banner'];

/**
 * Tags for a media article write. Only blog-type articles have a cached public
 * page (the catch-all /[slug] route) and feed the home journal shelf; press,
 * gallery and video items render client-side and need no Data Cache refresh.
 * @param {{slug?: string, type?: string}|null} article
 */
export const articleTags = (article) => {
  if (article?.type && article.type !== 'blog') return [];
  return ['home:journal', ...(article?.slug ? [`blog:${article.slug}`] : [])];
};

export default { productTags, productBulkTags, categoryTags, careersTags, articleTags, promoBannerTags };
