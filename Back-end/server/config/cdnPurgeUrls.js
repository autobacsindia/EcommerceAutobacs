/**
 * Invalidation tag → the edge URLs that tag makes stale.
 *
 * Cloudflare is on the FREE plan, which can only purge EXACT URLs (see
 * services/cdnPurgeService.js). Cloudflare keys its cache on the full URL
 * including the query string, so `/categories` and `/categories?limit=200` are
 * two independent entries and purging one does nothing for the other.
 *
 * That makes an endpoint purgeable only if the set of URLs clients actually
 * request for it is CLOSED — enumerable here, in full. Endpoints whose callers
 * vary the query string (`?limit=${n}`, `?page=${n}`, search terms, per-entity
 * ids) have an open set: any list we wrote here would purge the variants we
 * happened to think of and silently leave the rest stale, while still reporting
 * success. Those endpoints must not carry `s-maxage` at all — see
 * config/cacheProfiles.js, where each is marked and the pairing is enforced by
 * a test.
 *
 * So: a path belongs in this file ONLY if every caller requests it with no
 * query string. Adding a path here is a claim that this is true. If a caller
 * later appends a parameter, the claim breaks silently — which is why the
 * frontend's actual call sites, not the route definition, are the thing to
 * check before adding an entry.
 */

/**
 * Verified 2026-09-19 against the frontend's call sites: each of these is
 * requested with a bare path and no query string anywhere in Front-end/web/src.
 */
export const CLOSED_URL_PATHS = Object.freeze({
  // GET /vehicles/makes — VEHICLE_MAKES. The make list behind the vehicle
  // pickers; written by the admin vehicle screens.
  vehicles: ['/vehicles/makes'],

  // GET /reviews/testimonials — TESTIMONIALS. Home-page testimonial strip.
  reviews: ['/reviews/testimonials'],

  // GET /promo-banners/active — the site-wide promo strip. Still on the legacy
  // middleware/cacheControl.js cacheMiddleware('static-data') rather than
  // httpCache, so it has no CACHE_PROFILES entry; the header is the same.
  'public:promo-banner': ['/promo-banners/active'],
});

/**
 * Union of closed URL paths made stale by these invalidation patterns.
 * Unknown patterns contribute nothing — deliberately, so a per-entity tag like
 * `product:<slug>` is a silent no-op here rather than an error.
 *
 * @param {string[]} patterns
 * @returns {string[]} de-duplicated API-relative paths
 */
export function pathsForPatterns(patterns = []) {
  const out = new Set();
  for (const pattern of patterns) {
    for (const path of CLOSED_URL_PATHS[pattern] || []) out.add(path);
  }
  return [...out];
}

export default { CLOSED_URL_PATHS, pathsForPatterns };
