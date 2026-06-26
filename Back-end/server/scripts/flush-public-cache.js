/**
 * Flush the HTTP response caches after a data migration.
 *
 * The app caches GET responses under two prefixes:
 *   route:*   — middleware/cacheMiddleware.js  (cacheResponse)
 *   public:*  — middleware/publicCacheMiddleware.js (publicCacheResponse)
 * The older clear-product-cache.js predates both and misses them, so product
 * pages can serve stale prices until each key's TTL lapses (homepage "Featured"
 * is up to 1h). This clears both immediately.
 *
 * Uses SCAN + UNLINK (non-blocking) so it's safe on production Redis. Idempotent.
 *
 * Must run where REDIS_URL resolves — i.e. INSIDE Railway (the URL is a private
 * host). From the running service:  railway ssh -- npm run flush-cache
 *
 * Requires REDIS_URL.
 */

import Redis from 'ioredis';

const PATTERNS = ['route:*', 'public:*'];

async function flushPattern(redis, match) {
  let scanned = 0, deleted = 0;
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
  console.log(`${match.padEnd(10)} — scanned ${scanned}, deleted ${deleted}`);
  return deleted;
}

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) { console.error('[ERROR] REDIS_URL not set'); process.exit(1); }

  const redis = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  let total = 0;
  try {
    for (const p of PATTERNS) total += await flushPattern(redis, p);
    console.log(`\nDone. Deleted ${total} cache key(s).`);
  } catch (err) {
    console.error('[flush-public-cache] failed:', err.message);
    await redis.quit();
    process.exit(1);
  }
  await redis.quit();
  process.exit(0);
}

main();
