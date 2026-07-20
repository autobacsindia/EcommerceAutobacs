/**
 * Cache TTLs must be passed to CacheService in SECONDS.
 *
 * Regression: cacheMiddleware (and routes/deliveryZones.js) passed
 * `ttlSeconds * 1000` to cacheService.set() on the strength of a stale
 * "expects milliseconds" comment. CacheService.set() feeds the value straight
 * into Redis `EX <ttl>` (seconds), so a 600s route cache actually lived for
 * 600,000s ≈ 6.9 days — categories/brands served stale for days after edits.
 * The unified httpCache (CATEGORY_LIST = 600s) must store seconds.
 *
 * Runs against the real CacheService with REDIS_URL unset (in-memory Map path,
 * where expiry = Date.now() + ttl * 1000), so the stored expiry directly
 * reveals the unit the caller passed.
 */

const { default: cacheService } = await import('../../../services/cacheService.js');
const { httpCache } = await import('../../../middleware/httpCache.js');

/** Drive the caching middleware to completion so it writes through res.json. */
const primeCache = async (profile, url, payload) => {
  const req = { method: 'GET', originalUrl: url, query: {}, headers: {}, cookies: {} };
  const res = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    json(body) { this.body = body; return this; },
  };
  await new Promise((resolve) => httpCache(profile)(req, res, resolve));
  res.json(payload);
  await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  cacheService.cache.clear();
  cacheService.tagMap.clear();
});

describe('httpCache TTL unit (CATEGORY_LIST = 600s)', () => {
  it('stores a 600-second TTL as ~10 minutes, not ~6.9 days', async () => {
    const before = Date.now();
    await primeCache('CATEGORY_LIST', '/api/v1/categories', { categories: [] });

    const entries = [...cacheService.cache.values()];
    expect(entries).toHaveLength(1);

    const lifetimeMs = entries[0].expiry - before;
    // Sanity band: ≥ ~9 min (not seconds-as-something-shorter) and well under
    // an hour (the ×1000 bug produced ~166 hours).
    expect(lifetimeMs).toBeGreaterThanOrEqual(590 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(610 * 1000);
  });
});

describe('CacheService.set TTL contract', () => {
  it('treats the ttl argument as seconds on the in-memory path', async () => {
    const before = Date.now();
    await cacheService.set('delivery-zones:list:all:all', { zones: [] }, 300);

    const entry = cacheService.cache.get('delivery-zones:list:all:all');
    const lifetimeMs = entry.expiry - before;
    expect(lifetimeMs).toBeGreaterThanOrEqual(295 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(305 * 1000);
  });
});
