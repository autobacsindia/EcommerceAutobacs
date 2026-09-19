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
  // `max-age` (the BROWSER copy) is deliberately short on every profile here.
  // A browser copy cannot be purged by anything we control, so its lifetime is a
  // hard floor on how long a stale answer can survive a write. `vehicle-data`
  // used to carry max-age=1800: an admin who added a vehicle then opened the
  // product editor was served the 30-minute-old list out of their own disk cache
  // and concluded the write had not taken.
  //
  // `s-maxage` is cut from 3600 to 300, and carries NO stale-while-revalidate,
  // for a reason specific to this data: no write path in this codebase purges
  // Cloudflare (invalidatePublicCache clears Redis only), so the edge TTL is not
  // a "worst case before a purge" — it is simply how long a deleted vehicle
  // keeps being served. Deleting a vehicle is now permanent, so a storefront
  // grid served from a stale edge copy links to a hard 404. An swr window would
  // stack on top of the TTL and extend exactly that. 300s matches the Redis TTL
  // for VEHICLE_LIST below, so the two layers expire together instead of the
  // edge outliving the origin cache by an hour.
  'vehicle-data':    'public, max-age=60, s-maxage=300',
  'search-results':  'public, max-age=120, s-maxage=300',

  // For `edge: 'purgeable'` profiles ONLY. A long s-maxage is safe here in a way
  // it is nowhere else in this file: invalidateCache purges these exact URLs
  // from Cloudflare on write (services/cdnPurgeService.js), so the TTL is a
  // genuine worst case before a purge rather than "how long the write stays
  // invisible". This is the TTL the purge work was done to unlock — `vehicle-data`
  // had been cut 3600 -> 300 purely to bound un-purgeable staleness.
  //
  // `max-age` stays short regardless: a BROWSER copy cannot be purged by
  // anything we control, so it remains the hard floor on staleness.
  'purgeable-static': 'public, max-age=60, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=86400',
};

/**
 * ── Edge-cacheability classification ────────────────────────────────────────
 *
 * Cloudflare (Free plan) can only purge EXACT URLs, so an endpoint is only
 * purgeable if the set of URLs clients request for it is closed and listed in
 * config/cdnPurgeUrls.js. Most are not. That leaves a choice per profile, and
 * making it explicit is the point: before this, every profile carried
 * `s-maxage` and NOTHING purged the edge, so staleness was uniform, invisible
 * and unintended.
 *
 * Every profile with an `http` key MUST declare one of:
 *
 *   'purgeable' — closed URL set, listed in cdnPurgeUrls. Keeps s-maxage;
 *                 invalidateCache purges the edge on write.
 *
 *   'none'      — MONEY PATH. Emits `private, max-age=N`: the browser may
 *                 store it, no shared cache may. Used wherever a stale answer
 *                 is a price, a discount or an availability claim — "stale
 *                 price at the edge is a trust and consumer-law problem, not a
 *                 cosmetic one" (root CLAUDE.md). Since these cannot be purged,
 *                 not caching them is the only compliant option.
 *
 *   'ttl'       — open URL set, but the data carries no money and tolerates
 *                 going stale for its s-maxage. Keeps edge caching and requires
 *                 `edgeReason` stating why staleness is acceptable HERE.
 *
 * A profile that declares nothing fails at boot (see the validation below), so
 * a new cacheable route cannot silently inherit unpurgeable staleness.
 */
export const EDGE_MODES = Object.freeze(['purgeable', 'none', 'ttl']);

/**
 * Strip the shared-cache directives from a header, leaving the browser copy.
 * `private` is emitted explicitly rather than relying on the absence of
 * `s-maxage`: it is the unambiguous instruction that no shared cache — CDN or
 * corporate proxy — may store the response.
 */
export function toPrivateHeader(header) {
  const maxAge = /(?:^|[\s,])max-age=(\d+)/.exec(header);
  return `private, max-age=${maxAge ? maxAge[1] : 0}`;
}

/**
 * Will SOME cache we control store this response?
 *
 * Not the same question as "may a shared cache store it". A money-path profile
 * ships `private, max-age=300`: Cloudflare must not hold it, but httpCache
 * still stores it in Redis, and Redis IS shared between users. So anything that
 * would poison a stored response — a per-user `Set-Cookie`, above all — has to
 * treat this as cacheable too.
 *
 * Getting this wrong is not a subtle bug. csrfMiddleware suppresses the
 * XSRF-TOKEN cookie on cacheable GETs precisely because httpCache refuses to
 * store any response carrying Set-Cookie; if this predicate says "not
 * cacheable" for a response Redis would have stored, the cookie gets minted,
 * httpCache then declines to store it, and the entire cache layer goes inert
 * while looking perfectly healthy. That is the 2026-08-03 site-wide outage.
 *
 * `max-age=0` and anything with `no-store` are deliberately NOT storable, and a
 * response with no Cache-Control at all is not either.
 */
const STORABLE = /^\s*(?:public\b|private,\s*max-age=[1-9])/i;

export function isStorableCacheControl(header) {
  const value = String(header || '');
  if (/no-store/i.test(value)) return false;
  return STORABLE.test(value);
}

/** The Cache-Control a profile actually emits, after its edge classification. */
export function resolveCacheControl(profile) {
  const header = profile.http && HTTP_CACHE_HEADERS[profile.http];
  if (!header) return null;
  return profile.edge === 'none' ? toPrivateHeader(header) : header;
}

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
  PRODUCT_LIST:          { edge: 'none', ttl: 300,  strategy: 'lock', regional: true, tags: ['products'], http: 'product-listing' },
  PRODUCT_DETAIL:        { edge: 'none', ttl: 120,  tags: productDetailTags, http: 'product-detail' },
  PRODUCT_FEATURED:      { edge: 'none', ttl: 3600, tags: ['products', 'products:featured'], http: 'product-listing' },
  PRODUCT_OFFERS:        { edge: 'none', ttl: 1800, tags: ['products'], http: 'product-listing' },
  PRODUCT_SEARCH:        { edge: 'none', ttl: 60,   tags: ['products'], http: 'search-results' },
  PRODUCT_HISTORY:       { edge: 'none', ttl: 300,  tags: ['products'], http: 'search-results' },
  PRODUCT_SIMILAR:       { edge: 'none', ttl: 120,  tags: ['products'], http: 'product-listing' },
  PRODUCT_COMPLEMENTARY: { edge: 'none', ttl: 120,  tags: ['products'], http: 'product-listing' },
  PRODUCT_BRANDS:        { edge: 'none', ttl: 600,  tags: ['products', 'brands'], http: 'static-data' },
  // strategy 'lock' = the CONTROLLER owns the Redis entry (getProductFacets builds
  // its own canonical key via utils/facetCacheKey.js, TTL 300s, tag 'products').
  // httpCache therefore stores nothing here — it exists purely to emit the
  // Cache-Control header and enforce the Set-Cookie / non-2xx guard.
  //
  // Without it this route emitted NO Cache-Control at all, so csrfMiddleware's
  // deferCsrfCookie() saw a non-public response and minted XSRF-TOKEN on it — and a
  // Set-Cookie response is one Cloudflare will never cache. The filter sidebar, one
  // of the busiest public GETs, reached the origin on every single request. Same
  // failure as the 2026-08-03 site-wide csrf/cache bug, on the one route that was
  // never wired up. `ttl` mirrors the controller's own 300s so the two cannot drift
  // silently; s-maxage=300 in 'search-results' matches it.
  PRODUCT_FACETS:        { edge: 'none', ttl: 300,  strategy: 'lock', tags: ['products'], http: 'search-results' },

  // ── Categories ────────────────────────────────────────────────────────────
  CATEGORY_LIST: { edge: 'none', ttl: 600, tags: ['categories'], http: 'static-data' },
  CATEGORY_ITEM: { edge: 'none', ttl: 600, tags: ['categories'], http: 'static-data' },

  // ── Brands ────────────────────────────────────────────────────────────────
  BRAND_LIST:     { edge: 'none', ttl: 600, tags: ['brands'], http: 'static-data' },
  BRAND_PRODUCTS: { edge: 'none', ttl: 300, tags: ['brands', 'products'], http: 'static-data' },

  // ── Vehicles ──────────────────────────────────────────────────────────────
  VEHICLE_LIST:  { edge: 'ttl', edgeReason:
    'GET /vehicles is also requested as ?limit=1000, so the URL set is open and only VEHICLE_MAKES is purgeable. Carries no price; a vehicle added or renamed appears within s-maxage. Deleting one is the sharp edge (a stale grid links to a hard 404), which is why s-maxage stays at 300 here and deliberately gets no stale-while-revalidate extension.', ttl: 300,  tags: ['vehicles'], http: 'vehicle-data' },
  VEHICLE_MAKES: { edge: 'purgeable', ttl: 7200, tags: ['vehicles'], http: 'purgeable-static' },

  // ── Reviews / Q&A / page SEO (Phase 3: previously uncached read-heavy) ──────
  REVIEWS_PRODUCT: { edge: 'ttl', edgeReason:
    'Per-product URL, so the set is open. A review appearing up to s-maxage late is not a correctness problem; nothing here is priced.', ttl: 300,  tags: (req) => ['reviews', `reviews:product:${req.params.productId}`], http: 'static-data' },
  REVIEWS_SUMMARY: { edge: 'ttl', edgeReason:
    'Same per-product URL shape as REVIEWS_PRODUCT. An average rating lagging by minutes is cosmetic.', ttl: 600,  tags: (req) => ['reviews', `reviews:product:${req.params.productId}`], http: 'static-data' },
  TESTIMONIALS:    { edge: 'purgeable', ttl: 3600, tags: ['reviews'], http: 'purgeable-static' },
  QA_PRODUCT:      { edge: 'ttl', edgeReason:
    'Per-product URL. An answer showing up a few minutes late costs nothing; no money in the payload.', ttl: 600,  tags: (req) => ['questions', `questions:product:${req.params.id || req.params.productId}`], http: 'static-data' },
  PAGESEO_PUBLIC:  { edge: 'ttl', edgeReason:
    'Per-path URL, open set. Metadata changes are rare and editorial, and crawlers re-fetch on their own schedule.', ttl: 3600, tags: ['pageseo'], http: 'static-data' },
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
  // Every cacheable profile must state whether a shared cache may hold it, and
  // why. Defaulting would put the decision back where it was: implicit, and
  // therefore uniformly wrong.
  if (profile.http && !EDGE_MODES.includes(profile.edge)) {
    throw new Error(
      `[cacheProfiles] ${name} has no valid \`edge\` classification ` +
      `(got ${JSON.stringify(profile.edge)}; expected one of ${EDGE_MODES.join(' | ')}). ` +
      `A cacheable route must declare whether Cloudflare may hold it — see the ` +
      `classification block above.`
    );
  }
  // 'ttl' is the only mode that accepts unpurgeable staleness. Making the
  // reason mandatory is what stops it becoming the lazy default.
  if (profile.edge === 'ttl' && !profile.edgeReason) {
    throw new Error(
      `[cacheProfiles] ${name}.edge='ttl' keeps s-maxage on an un-purgeable URL set, ` +
      `so it MUST set \`edgeReason\` explaining why staleness is acceptable here.`
    );
  }
}
