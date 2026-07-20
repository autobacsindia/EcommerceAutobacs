import cacheService from '../services/cacheService.js';
import Sentry from '../config/sentry.js';

/**
 * Cache invalidation for write paths.
 *
 * NOTE: the response-caching middleware that used to live here (`cacheResponse`)
 * was retired in the caching overhaul — all cacheable routes now use
 * middleware/httpCache.js. This file keeps only the invalidation helper, which
 * many write paths already call.
 *
 * Invalidate all cached entries associated with any of the given patterns.
 * Fire-and-forget: does NOT block the HTTP response. Errors are surfaced to
 * Sentry (a failed invalidation means stale cache served until TTL) but never
 * propagated to the caller.
 *
 * @param {...string} patterns - tags (primary) / key substrings (fallback)
 *
 * Usage (inside an async handler, after the DB write):
 *   import { invalidateCache } from '../middleware/cacheMiddleware.js';
 *   invalidateCache('brands', 'products');
 */
export const invalidateCache = (...patterns) => {
  // Two mechanisms run per pattern:
  //   1. invalidateTags — the deterministic path. Keys stored by httpCache /
  //      getWithLock / service wrap are filed under these tags in the Redis tag
  //      index, so this is an exact lookup, not a keyspace scan.
  //   2. invalidatePattern — a SCAN-glob fallback that also clears any legacy or
  //      untagged keys (pre-v3 route:/public:/v2: entries, the delivery-zones
  //      cache, in-memory test keys). Cheap: only runs on admin write paths.
  Promise.all(patterns.flatMap((pattern) => [
    cacheService.invalidateTags(pattern),
    cacheService.invalidatePattern(pattern),
  ]))
    .then((counts) => {
      const total = counts.reduce((sum, n) => sum + (n || 0), 0);
      console.log(`[Cache] Invalidated ${total} key(s) for patterns:`, patterns);
    })
    .catch((err) => {
      console.warn(`[Cache] Invalidation failed for patterns: ${patterns.join(', ')}`, err);
      Sentry.captureException(err, { tags: { area: 'cache-invalidation' }, extra: { patterns } });
    });
};
