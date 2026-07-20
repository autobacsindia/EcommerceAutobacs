/**
 * Shared response-cache flush core.
 *
 * Single implementation of the SCAN + UNLINK sweep used by both:
 *   - scripts/flush-public-cache.js  (CLI, run inside Railway after migrations)
 *   - POST /admin/redis/cache/clear  (via CacheService.clear())
 *
 * SCAN + UNLINK is non-blocking and safe on production Redis (Upstash).
 *
 * Patterns cover every cache namespace the app writes:
 *   route:*          — middleware/cacheMiddleware.js  (cacheResponse)
 *   public:*         — middleware/publicCacheMiddleware.js (publicCacheResponse)
 *   v2:*             — CacheService.generateKey() controller/service caches
 *                      (products list, featured/offers/brands, analytics).
 *                      Also matches transient `:lock` keys — deleting a
 *                      stampede lock early is harmless.
 *   delivery-zones:* — routes/deliveryZones.js manual cache
 *
 * Sessions (session:*), rate limits and webhook-replay keys are NOT matched —
 * a cache flush must never log users out.
 */

import { CACHE_VERSION } from './config.js';

export const RESPONSE_CACHE_PATTERNS = [
  'route:*',            // legacy cacheMiddleware (pre-v3)
  'public:*',           // legacy publicCacheMiddleware (pre-v3)
  'v2:*',               // legacy controller/service keys (pre-v3)
  `${CACHE_VERSION}:*`, // current unified keys (v3:resp:*) + versioned service keys
  'ctag:*',             // tag index sets (services/cache/tagIndex.js)
  'delivery-zones:*',   // routes/deliveryZones.js manual cache
];

/**
 * Delete all keys matching a single glob via SCAN + UNLINK.
 * @param {import('ioredis').Redis} redis
 * @param {string} match glob pattern
 * @returns {Promise<{scanned: number, deleted: number}>}
 */
export async function flushPattern(redis, match) {
  let scanned = 0;
  let deleted = 0;
  await new Promise((resolve, reject) => {
    const stream = redis.scanStream({ match, count: 200 });
    stream.on('data', (keys) => {
      if (!keys.length) return;
      scanned += keys.length;
      stream.pause();
      redis.unlink(keys)
        .then((n) => { deleted += n; stream.resume(); })
        .catch((e) => { console.error(`  unlink error (${match}):`, e.message); stream.resume(); });
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return { scanned, deleted };
}

/**
 * Flush every response-cache namespace. Idempotent.
 * @param {import('ioredis').Redis} redis
 * @param {string[]} [patterns]
 * @returns {Promise<{total: number, perPattern: Record<string, number>}>}
 */
export async function flushResponseCaches(redis, patterns = RESPONSE_CACHE_PATTERNS) {
  const perPattern = {};
  let total = 0;
  for (const pattern of patterns) {
    const { deleted } = await flushPattern(redis, pattern);
    perPattern[pattern] = deleted;
    total += deleted;
  }
  return { total, perPattern };
}
