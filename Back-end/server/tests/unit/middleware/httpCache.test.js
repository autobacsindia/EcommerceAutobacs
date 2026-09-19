/**
 * Unified response-cache middleware (middleware/httpCache.js).
 *
 * Exercises the middleware against the real CacheService with REDIS_URL unset
 * (in-memory Map path) — no external Redis touched. Covers the safety-critical
 * behaviours: HIT/MISS, auth + kill-switch bypass, never caching Set-Cookie or
 * non-2xx responses, tag registration, and the Cache-Control header contract.
 */

import { jest } from '@jest/globals';

const { default: cacheService } = await import('../../../services/cacheService.js');
const { httpCache, buildResponseKey } = await import('../../../middleware/httpCache.js');
const { CACHE_PROFILES } = await import('../../../config/cacheProfiles.js');

/** Build a fake res whose json()/headers we can inspect. */
const makeRes = (statusCode = 200) => {
  const headers = {};
  return {
    statusCode,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    json(body) { this.body = body; return this; },
  };
};

const makeReq = (over = {}) => ({
  method: 'GET',
  originalUrl: '/api/v1/categories',
  query: {},
  headers: {},
  cookies: {},
  ...over,
});

/** Run middleware then the handler's res.json, letting write-through settle. */
const run = async (mw, req, res, body) => {
  await new Promise((resolve) => mw(req, res, resolve));
  res.json(body);
  await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  cacheService.cache.clear();
  cacheService.tagMap.clear();
  cacheService.keyTags.clear();
  delete process.env.CACHE_DISABLED;
});

describe('httpCache HIT / MISS', () => {
  it('stores on first request and serves from cache on the second', async () => {
    const mw = httpCache('CATEGORY_LIST');

    const res1 = makeRes();
    await run(mw, makeReq(), res1, { categories: ['a'] });
    expect(res1.getHeader('X-Cache')).toBe('MISS');

    // Second call: cache HIT returns via res.json WITHOUT calling next(), so
    // resolve on whichever fires first.
    const res2 = makeRes();
    let handlerRan = false;
    await new Promise((resolve) => {
      const origJson = res2.json.bind(res2);
      res2.json = (b) => { origJson(b); resolve(); return res2; };
      mw(makeReq(), res2, () => { handlerRan = true; resolve(); });
    });
    expect(res2.getHeader('X-Cache')).toBe('HIT');
    expect(res2.body).toEqual({ categories: ['a'] });
    expect(handlerRan).toBe(false);
  });
});

describe('httpCache bypass rules', () => {
  it('does not cache authenticated requests and marks them private', async () => {
    const mw = httpCache('CATEGORY_LIST');
    const req = makeReq({ headers: { authorization: 'Bearer x' } });
    const res = makeRes();

    let handlerRan = false;
    await new Promise((resolve) => mw(req, res, () => { handlerRan = true; resolve(); }));

    expect(handlerRan).toBe(true);
    expect(res.getHeader('Cache-Control')).toMatch(/private, no-store/);
    expect(cacheService.cache.size).toBe(0);
  });

  it('passes through untouched when CACHE_DISABLED=1', async () => {
    process.env.CACHE_DISABLED = '1';
    const mw = httpCache('CATEGORY_LIST');
    const res = makeRes();
    await run(mw, makeReq(), res, { categories: ['a'] });

    expect(res.getHeader('X-Cache')).toBeUndefined();
    expect(cacheService.cache.size).toBe(0);
  });
});

describe('httpCache never caches unsafe responses', () => {
  it('skips responses that set a cookie', async () => {
    const mw = httpCache('CATEGORY_LIST');
    const res = makeRes();
    res.setHeader('Set-Cookie', 'csrf=abc');
    await run(mw, makeReq(), res, { categories: ['a'] });
    expect(cacheService.cache.size).toBe(0);
  });

  it('skips non-2xx responses and marks them private', async () => {
    const mw = httpCache('CATEGORY_LIST');
    const res = makeRes(500);
    await run(mw, makeReq(), res, { error: 'boom' });
    expect(cacheService.cache.size).toBe(0);
    expect(res.getHeader('Cache-Control')).toMatch(/private, no-store/);
  });
});

describe('httpCache tag registration + invalidation', () => {
  it('files a product-detail entry under per-entity tags and clears them', async () => {
    const mw = httpCache('PRODUCT_DETAIL');
    const req = makeReq({ originalUrl: '/api/v1/products/slug/brake-pad' });
    await run(mw, req, makeRes(), { success: true, product: { _id: 'p1', slug: 'brake-pad' } });

    // Registered under 'products', 'product:p1', and 'product:brake-pad'.
    expect(cacheService.tagMap.has('product:p1')).toBe(true);
    expect(cacheService.tagMap.has('product:brake-pad')).toBe(true);

    const removed = await cacheService.invalidateTags('product:brake-pad');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(cacheService.cache.size).toBe(0);
  });
});

describe('httpCache Cache-Control header', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = original; });

  it('emits the public CDN directive for an edge-cacheable profile', async () => {
    // PAGESEO_PUBLIC is edge:'ttl' — open URL set but no money in the payload,
    // so a shared cache may hold it.
    process.env.NODE_ENV = 'production';
    const mw = httpCache('PAGESEO_PUBLIC');
    const res = makeRes();
    await run(mw, makeReq({ originalUrl: '/api/v1/page-seo/product/1' }), res, { success: true });
    expect(res.getHeader('Cache-Control')).toMatch(/^public, /);
    expect(res.getHeader('Cache-Control')).toMatch(/s-maxage=/);
  });

  it('downgrades a money-path profile to private, so no shared cache holds a price', async () => {
    // PRODUCT_DETAIL is edge:'none'. It used to emit
    // `public, max-age=60, s-maxage=300, stale-while-revalidate=600`, which let
    // Cloudflare serve a superseded price for up to 5 minutes with no purge path
    // to cut it short. See the edge classification in config/cacheProfiles.js.
    process.env.NODE_ENV = 'production';
    const mw = httpCache('PRODUCT_DETAIL');
    const res = makeRes();
    await run(mw, makeReq({ originalUrl: '/api/v1/products/slug/x' }), res, { success: true, product: { _id: 'p', slug: 'x' } });
    expect(res.getHeader('Cache-Control')).toBe('private, max-age=60');
  });

  it('forces no-store outside production', async () => {
    process.env.NODE_ENV = 'test';
    const mw = httpCache('CATEGORY_LIST');
    const res = makeRes();
    await run(mw, makeReq(), res, { categories: [] });
    expect(res.getHeader('Cache-Control')).toMatch(/no-store/);
  });

  it('downgrades a lock-profile response to private when it sets a cookie', async () => {
    // Regression: /products (PRODUCT_LIST = lock) used to emit the public
    // s-maxage header alongside a Set-Cookie CSRF token — a shared-cache leak.
    process.env.NODE_ENV = 'production';
    const mw = httpCache('PRODUCT_LIST');
    const res = makeRes();
    // Simulate the controller: sets X-Cache itself, and the CSRF middleware has
    // stamped a Set-Cookie earlier in the chain.
    await new Promise((resolve) => mw(makeReq({ originalUrl: '/api/v1/products' }), res, resolve));
    // Optimistic header. It is `private` now because PRODUCT_LIST is a money
    // path (edge:'none'), NOT because of the cookie — the cookie guard below is
    // what must still flip it to no-store.
    expect(res.getHeader('Cache-Control')).toBe('private, max-age=300'); // optimistic
    res.setHeader('Set-Cookie', 'XSRF-TOKEN=abc');
    res.setHeader('X-Cache', 'MISS');
    res.json({ success: true, products: [] });
    expect(res.getHeader('Cache-Control')).toMatch(/private, no-store/);
    expect(res.getHeader('X-Cache')).toBe('MISS'); // controller's value preserved
  });

  it('keeps the profile header for a lock-profile response with no cookie', async () => {
    process.env.NODE_ENV = 'production';
    const mw = httpCache('PRODUCT_LIST');
    const res = makeRes();
    await new Promise((resolve) => mw(makeReq({ originalUrl: '/api/v1/products' }), res, resolve));
    res.setHeader('X-Cache', 'HIT');
    res.json({ success: true, products: [] });
    expect(res.getHeader('Cache-Control')).toBe('private, max-age=300');
    expect(res.getHeader('X-Cache')).toBe('HIT');
  });

  it('a Set-Cookie still strips a PUBLIC header — the shared-cache leak guard', async () => {
    // The original regression was a public s-maxage header shipping alongside a
    // Set-Cookie CSRF token, which a shared cache would store and then serve to
    // other users. Once PRODUCT_LIST became `private` that test could no longer
    // prove the guard, because the header was already private for another
    // reason. This re-proves it on a profile that genuinely emits `public`.
    process.env.NODE_ENV = 'production';
    const mw = httpCache('PAGESEO_PUBLIC');
    const res = makeRes();
    await new Promise((resolve) => mw(makeReq({ originalUrl: '/api/v1/page-seo/product/1' }), res, resolve));
    expect(res.getHeader('Cache-Control')).toMatch(/^public, /);

    res.setHeader('Set-Cookie', 'XSRF-TOKEN=abc');
    res.json({ success: true });
    expect(res.getHeader('Cache-Control')).toMatch(/private, no-store/);
  });
});

describe('buildResponseKey', () => {
  it('is stable for identical requests and namespaced by resource', () => {
    const req = makeReq({ originalUrl: '/api/v1/products?page=1', query: { page: '1' } });
    const k1 = buildResponseKey(req, CACHE_PROFILES.PRODUCT_LIST);
    const k2 = buildResponseKey(req, CACHE_PROFILES.PRODUCT_LIST);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^v3:resp:products:[a-f0-9]{32}$/);
  });

  it('differs by query', () => {
    const a = buildResponseKey(makeReq({ query: { page: '1' } }), CACHE_PROFILES.CATEGORY_LIST);
    const b = buildResponseKey(makeReq({ query: { page: '2' } }), CACHE_PROFILES.CATEGORY_LIST);
    expect(a).not.toBe(b);
  });
});
