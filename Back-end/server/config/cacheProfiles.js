/**
 * Response-cache profile table — the single source of truth for every cached
 * public GET route. One entry drives all three layers at once:
 *   - Redis TTL           (how long CacheService stores the JSON)
 *   - invalidation tags   (which ctag: sets the key is filed under)
 *   - HTTP Cache-Control   (what the CDN/browser is told)
 *
 * This replaces the two forked systems it grew out of: publicCacheMiddleware's
 * hard-coded TTL `switch` and cacheControl.js's separate header map. Keeping TTL
 * and headers side by side is what stops them drifting (Phase 0 found a 1000×
 * TTL bug and headers applied to only 4 of ~15 cacheable routes).
 *
 * Fields per profile:
 *   ttl       {number}   seconds; must be ≤ MAX_TAGGED_TTL so tags stay valid
 *   tags      {string[] | (req, body) => string[]}  invalidation tags. A
 *             function derives per-entity tags (e.g. product:<id>) from the
 *             response body.
 *   strategy  {'basic'|'lock'}  'lock' routes through CacheService.getWithLock
 *             for stampede protection (used by the product list).
 *   regional  {boolean}  include CacheService.regionId in the key (price/currency
 *             varies by region). Default false.
 *   http      {string}   key into HTTP_CACHE_HEADERS below (the CDN/browser
 *             directive). Omit for no explicit Cache-Control.
 */

import { MAX_TAGGED_TTL } from '../services/cache/tagIndex.js';

/**
 * HTTP Cache-Control header profiles (production only — dev forces no-store in
 * httpCache). Folded in from the former middleware/cacheControl.js.
 *
 * CDN contract (Cloudflare in front of api.<domain>): we do NOT emit
 * `Vary: Cookie` (analytics cookies would fragment the shared cache to ~0 hit
 * rate); instead Cloudflare is configured to BYPASS cache when an auth cookie is
 * present, and httpCache emits `private, no-store` on any authenticated or
 * non-2xx response so user data can never be edge-cached.
 */
export const HTTP_CACHE_HEADERS = {
  'product-listing': 'public, max-age=300, s-maxage=600',
  'product-detail':  'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  'static-data':     'public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400',
  'vehicle-data':    'public, max-age=1800, s-maxage=3600',
  'search-results':  'public, max-age=120, s-maxage=300',
};

/** Emitted for authenticated requests and any non-cacheable response. */
export const PRIVATE_NO_STORE = 'private, no-store, no-cache, must-revalidate';

/** Per-entity tag helpers so detail routes invalidate precisely. */
const productDetailTags = (_req, body) => {
  const p = body?.product || {};
  const tags = ['products'];
  if (p._id) tags.push(`product:${p._id}`);
  if (p.slug) tags.push(`product:${p.slug}`);
  return tags;
};

export const CACHE_PROFILES = {
  // ── Products ──────────────────────────────────────────────────────────────
  PRODUCT_LIST:          { ttl: 300,  strategy: 'lock', regional: true, tags: ['products'], http: 'product-listing' },
  PRODUCT_DETAIL:        { ttl: 120,  tags: productDetailTags, http: 'product-detail' },
  PRODUCT_FEATURED:      { ttl: 3600, tags: ['products', 'products:featured'], http: 'product-listing' },
  PRODUCT_OFFERS:        { ttl: 1800, tags: ['products'], http: 'product-listing' },
  PRODUCT_SEARCH:        { ttl: 60,   tags: ['products'], http: 'search-results' },
  PRODUCT_HISTORY:       { ttl: 300,  tags: ['products'], http: 'search-results' },
  PRODUCT_SIMILAR:       { ttl: 120,  tags: ['products'], http: 'product-listing' },
  PRODUCT_COMPLEMENTARY: { ttl: 120,  tags: ['products'], http: 'product-listing' },
  PRODUCT_BRANDS:        { ttl: 600,  tags: ['products', 'brands'], http: 'static-data' },

  // ── Categories ────────────────────────────────────────────────────────────
  CATEGORY_LIST: { ttl: 600, tags: ['categories'], http: 'static-data' },
  CATEGORY_ITEM: { ttl: 600, tags: ['categories'], http: 'static-data' },

  // ── Brands ────────────────────────────────────────────────────────────────
  BRAND_LIST:     { ttl: 600, tags: ['brands'], http: 'static-data' },
  BRAND_PRODUCTS: { ttl: 300, tags: ['brands', 'products'], http: 'static-data' },

  // ── Vehicles ──────────────────────────────────────────────────────────────
  VEHICLE_LIST:  { ttl: 300,  tags: ['vehicles'], http: 'vehicle-data' },
  VEHICLE_MAKES: { ttl: 7200, tags: ['vehicles'], http: 'vehicle-data' },

  // ── Reviews / Q&A / page SEO (Phase 3: previously uncached read-heavy) ──────
  REVIEWS_PRODUCT: { ttl: 300,  tags: (req) => ['reviews', `reviews:product:${req.params.productId}`], http: 'static-data' },
  REVIEWS_SUMMARY: { ttl: 600,  tags: (req) => ['reviews', `reviews:product:${req.params.productId}`], http: 'static-data' },
  TESTIMONIALS:    { ttl: 3600, tags: ['reviews'], http: 'static-data' },
  QA_PRODUCT:      { ttl: 600,  tags: (req) => ['questions', `questions:product:${req.params.id || req.params.productId}`], http: 'static-data' },
  PAGESEO_PUBLIC:  { ttl: 3600, tags: ['pageseo'], http: 'static-data' },
};

/**
 * Resolve a profile's tags for a given request/response.
 * @returns {string[]}
 */
export function resolveTags(profile, req, body) {
  const { tags } = profile;
  if (typeof tags === 'function') return tags(req, body) || [];
  return tags || [];
}

// Fail fast at boot if a profile's TTL would outlive the tag index that
// invalidates it — a config mistake that would silently serve stale data.
for (const [name, profile] of Object.entries(CACHE_PROFILES)) {
  if (profile.ttl > MAX_TAGGED_TTL) {
    throw new Error(
      `[cacheProfiles] ${name}.ttl (${profile.ttl}s) exceeds MAX_TAGGED_TTL (${MAX_TAGGED_TTL}s); ` +
      `tag invalidation would not be guaranteed. Lower the TTL or raise TAG_INDEX_TTL.`
    );
  }
  if (profile.http && !HTTP_CACHE_HEADERS[profile.http]) {
    throw new Error(`[cacheProfiles] ${name}.http='${profile.http}' has no entry in HTTP_CACHE_HEADERS.`);
  }
}
