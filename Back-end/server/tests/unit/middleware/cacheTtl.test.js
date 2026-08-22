import { readFileSync } from 'fs';
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

/**
 * PRODUCT_FACETS is the one profile whose Redis entry is written by the CONTROLLER
 * (getProductFacets → utils/facetCacheKey.js) rather than by httpCache. That split
 * makes two numbers drift-prone, and nothing else in the app would notice:
 *
 *   - the profile's `ttl` is documentation only (lock profiles never store), so it
 *     must be kept equal to the TTL the controller actually passes, or the table
 *     lies to the next reader;
 *   - `strategy: 'lock'` is what STOPS httpCache opening a second store for data
 *     the controller already caches. Drop it and you get two caches for one
 *     resource with different keys and TTLs.
 */
describe('PRODUCT_FACETS profile contract', () => {
  it('keeps strategy=lock so httpCache never opens a second store', async () => {
    const { CACHE_PROFILES } = await import('../../../config/cacheProfiles.js');
    expect(CACHE_PROFILES.PRODUCT_FACETS.strategy).toBe('lock');
  });

  it('declares the same TTL the controller actually writes with', async () => {
    const { CACHE_PROFILES } = await import('../../../config/cacheProfiles.js');
    const { TTL } = await import('../../../services/cache/config.js');
    // getProductFacets calls cacheService.set(key, body, TTL.PRODUCT_LIST, ['products']).
    expect(CACHE_PROFILES.PRODUCT_FACETS.ttl).toBe(TTL.PRODUCT_LIST);
  });

  it('advertises a shared-cache lifetime no longer than the entry it fronts', async () => {
    const { CACHE_PROFILES, HTTP_CACHE_HEADERS } = await import('../../../config/cacheProfiles.js');
    const header = HTTP_CACHE_HEADERS[CACHE_PROFILES.PRODUCT_FACETS.http];
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(header)[1]);
    // A CDN holding facets longer than Redis does would outlive tag invalidation.
    expect(sMaxAge).toBeLessThanOrEqual(CACHE_PROFILES.PRODUCT_FACETS.ttl);
  });
});

/**
 * Route WIRING guard for /products/facets.
 *
 * The middleware logic is covered by unit tests, but those drive httpCache with a
 * hand-built req/res — they cannot see whether the route actually mounts it, under
 * the right profile name, in the right position.
 *
 * This is asserted structurally rather than with supertest on purpose. The
 * meaningful e2e assertion (the PUBLIC Cache-Control header, which is what
 * suppresses the CSRF cookie) only exists when NODE_ENV === 'production', and
 * flipping that inside an integration test also switches on production-only
 * middleware — including the emergency rate limiter, which engages precisely
 * because Redis is absent in tests:
 *
 *     [RateLimit] Redis unavailable - applying emergency local limit for: /facets
 *
 * That made a supertest version return 429 instead of 400, and only when other
 * tests had run first. Reading the source is deterministic and catches the
 * realistic regression: someone removing the middleware or moving it after the
 * validator.
 */
describe('/products/facets route wiring', () => {
  const routeLine = () => {
    // ESM: no `require`/`__dirname` here. readFileSync accepts a URL, and
    // import.meta.url is available under --experimental-vm-modules.
    const src = readFileSync(new URL('../../../routes/products.js', import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => l.includes('router.get("/facets"'));
    expect(line).toBeDefined();
    return line;
  };

  it('mounts httpCache with the PRODUCT_FACETS profile', () => {
    expect(routeLine()).toContain("httpCache('PRODUCT_FACETS')");
  });

  it('mounts it BEFORE the validator, so a 400 still gets its header downgraded', () => {
    const line = routeLine();
    const cacheAt = line.indexOf("httpCache('PRODUCT_FACETS')");
    const validatorAt = line.indexOf('validateProductSearch');
    // Assert presence first: indexOf returns -1 when absent, and -1 < anything, so
    // without this the ordering assertion passes vacuously on a removed middleware.
    expect(cacheAt).toBeGreaterThan(-1);
    expect(validatorAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeLessThan(validatorAt);
  });

  it('names a profile that actually exists (a typo would throw only at boot)', async () => {
    const { CACHE_PROFILES } = await import('../../../config/cacheProfiles.js');
    const name = /httpCache\('([A-Z_]+)'\)/.exec(routeLine())[1];
    expect(CACHE_PROFILES[name]).toBeDefined();
  });
});
