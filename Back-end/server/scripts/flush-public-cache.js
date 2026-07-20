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
 *
 * Edge cache (Cloudflare, see plan §C/§E): once api.<domain> is fronted by Cloudflare,
 * flushing only Redis leaves stale copies at the edge. If CLOUDFLARE_API_TOKEN +
 * CLOUDFLARE_ZONE_ID are set, this script also purges the Cloudflare zone so origin and
 * edge stay consistent. Both steps run together after bulk SEO/data changes. The purge is
 * skipped (no-op) when the creds are absent, so it's safe to run today pre-Cloudflare.
 */

import Redis from 'ioredis';
import { RESPONSE_CACHE_PATTERNS, flushPattern } from '../services/cache/flush.js';

/**
 * Purge the Cloudflare edge cache for the zone. No-op unless both env vars are set.
 * Token needs the "Zone → Cache Purge" permission, scoped to the zone.
 */
async function purgeCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    console.log('cloudflare  — skipped (CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID not set)');
    return;
  }
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purge_everything: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
      const detail = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      console.error(`cloudflare  — purge FAILED: ${detail}`);
      return;
    }
    console.log('cloudflare  — edge cache purged (purge_everything)');
  } catch (err) {
    console.error('cloudflare  — purge error:', err.message);
  }
}

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) { console.error('[ERROR] REDIS_URL not set'); process.exit(1); }

  const redis = new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
  let total = 0;
  try {
    // Same core as CacheService.clear() (admin /redis/cache/clear endpoint);
    // patterns now also cover the controller/service-level v2:* keys and
    // delivery-zones:* that the old route:/public:-only sweep missed.
    for (const p of RESPONSE_CACHE_PATTERNS) {
      const { scanned, deleted } = await flushPattern(redis, p);
      console.log(`${p.padEnd(18)} — scanned ${scanned}, deleted ${deleted}`);
      total += deleted;
    }
    console.log(`\nRedis: deleted ${total} cache key(s).`);
  } catch (err) {
    console.error('[flush-public-cache] failed:', err.message);
    await redis.quit();
    process.exit(1);
  }
  await redis.quit();

  // Purge the edge after the origin, so a cache MISS re-fills from fresh data.
  await purgeCloudflare();
  console.log('\nDone.');
  process.exit(0);
}

main();
