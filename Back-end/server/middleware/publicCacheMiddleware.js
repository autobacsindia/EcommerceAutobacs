import cacheService from '../services/cacheService.js';

/**
 * Public-cache invalidation for write paths.
 *
 * NOTE: the response-caching middleware that used to live here
 * (`publicCacheResponse`) was retired in the caching overhaul — all cacheable
 * routes now use middleware/httpCache.js. This file keeps only the invalidation
 * helper, which some write paths already call.
 *
 * Same dual mechanism as middleware/cacheMiddleware.js invalidateCache:
 * deterministic tag-index invalidation plus a SCAN-glob fallback for legacy /
 * untagged keys. Fire-and-forget; never awaited.
 *
 * @param {...string} patterns
 */
export const invalidatePublicCache = (...patterns) => {
  Promise.all(patterns.flatMap((pattern) => [
    cacheService.invalidateTags(pattern),
    cacheService.invalidatePattern(pattern),
  ]))
    .then((counts) => {
      const total = counts.reduce((sum, n) => sum + (n || 0), 0);
      console.log(`[PublicCache] Invalidated ${total} key(s) for patterns:`, patterns);
    })
    .catch((err) => {
      console.warn(`[PublicCache] Invalidation failed for patterns: ${patterns.join(', ')}`, err);
    });
};
