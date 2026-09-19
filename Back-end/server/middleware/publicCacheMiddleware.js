/**
 * Public-cache invalidation for write paths.
 *
 * NOTE: the response-caching middleware that used to live here
 * (`publicCacheResponse`) was retired in the caching overhaul — all cacheable
 * routes now use middleware/httpCache.js.
 *
 * `invalidatePublicCache` is now a thin alias for `invalidateCache`. The two
 * were byte-identical implementations of the same Redis tag + SCAN-glob sweep,
 * differing only in that this one did not report failures to Sentry. Keeping
 * two copies meant every future change to invalidation — the Cloudflare edge
 * purge being the immediate one — had to be made twice, and would be silently
 * half-applied the first time someone forgot. One implementation, one
 * chokepoint.
 *
 * The export stays because ~5 call sites in routes/products.js and
 * routes/vehicles.js use this name, and the rename is churn with no behaviour
 * change. New code should import `invalidateCache` directly.
 *
 * @param {...string} patterns tags (primary) / key substrings (fallback)
 */
export { invalidateCache as invalidatePublicCache } from './cacheMiddleware.js';
