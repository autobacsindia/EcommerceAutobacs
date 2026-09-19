import cacheService from '../services/cacheService.js';
import Sentry from '../config/sentry.js';
import { pathsForPatterns } from '../config/cdnPurgeUrls.js';
import { purgeEdgePaths } from '../services/cdnPurgeService.js';

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

  //   3. The Cloudflare edge. Clearing Redis alone left the edge serving the old
  //      response for the rest of its s-maxage, and NOTHING in this codebase
  //      purged it — so the edge TTL was not a worst case before a purge, it was
  //      simply how long the write stayed invisible. Only patterns with a CLOSED
  //      set of request URLs can be purged on the Free plan (exact-URL purge
  //      only); config/cdnPurgeUrls.js explains the rule and returns [] for
  //      everything else, so this is a no-op for most calls.
  //
  //      Separate promise chain on purpose: a CDN timeout must not mark the
  //      Redis invalidation above as failed, and vice versa.
  const edgePaths = pathsForPatterns(patterns);
  if (edgePaths.length) {
    purgeEdgePaths(edgePaths).catch((err) => {
      // purgeEdgePaths already logs + reports per batch; this is the last resort
      // so an unexpected throw cannot surface as an unhandled rejection.
      console.warn(`[Cache] Edge purge rejected for patterns: ${patterns.join(', ')}`, err);
    });
  }
};
