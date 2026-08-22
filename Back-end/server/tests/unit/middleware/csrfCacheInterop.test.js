/**
 * CSRF ↔ response-cache interoperability (middleware/csrfMiddleware.js).
 *
 * Regression guard for a production outage of the entire cache layer: csrf
 * minted XSRF-TOKEN on every GET, httpCache refuses to store (and downgrades the
 * CDN header on) any response carrying Set-Cookie, so /products, /categories,
 * /brands … served `private, no-store` + `X-Cache: MISS` forever and every
 * request reached Mongo.
 *
 * The contract these tests pin down:
 *   - anonymous GET on a cacheable route  → NO cookie, public header, real HIT
 *   - authenticated GET                   → cookie minted, private header
 *   - GET on an uncached route            → cookie minted (unchanged behaviour)
 *   - unsafe method with no cookie        → cookie minted (unchanged behaviour)
 */

const { default: cacheService } = await import('../../../services/cacheService.js');
const { httpCache } = await import('../../../middleware/httpCache.js');
const { csrfProtection, setCsrfCookie } = await import('../../../middleware/csrfMiddleware.js');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * Fake res mirroring the Express behaviour the middlewares depend on: cookie()
 * writes through to the Set-Cookie header, so httpCache's guard sees exactly
 * what it would in production.
 */
const makeRes = (statusCode = 200) => {
  const headers = {};
  return {
    statusCode,
    headersSent: false,
    locals: {},
    cookies: [],
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    cookie(name, value) {
      this.cookies.push(name);
      headers['set-cookie'] = [...(headers['set-cookie'] ?? []), `${name}=${value}`];
    },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
};

const makeReq = (over = {}) => ({
  method: 'GET',
  path: '/api/v1/categories',
  originalUrl: '/api/v1/categories',
  query: {},
  headers: {},
  cookies: {},
  ip: '127.0.0.1',
  ...over,
});

/**
 * Run middlewares in order then the handler, resolving once the response is
 * written. The resolver is installed first so it stays innermost and fires after
 * every wrapper (including csrf's deferred cookie) has run.
 */
const runChain = (mws, req, res, body) =>
  new Promise((resolve) => {
    const origJson = res.json.bind(res);
    res.json = function (b) { const out = origJson(b); resolve(); return out; };

    let i = 0;
    const next = () => {
      const mw = mws[i++];
      if (!mw) return void res.json(body);
      Promise.resolve(mw(req, res, next)).catch(resolve);
    };
    next();
  });

const hasCsrfCookie = (res) => res.cookies.includes('XSRF-TOKEN');

beforeEach(() => {
  cacheService.cache.clear();
  cacheService.tagMap.clear();
  cacheService.keyTags.clear();
  delete process.env.CACHE_DISABLED;
  // applyCacheHeader only emits the public CDN directive in production.
  process.env.NODE_ENV = 'production';
});

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('anonymous GET on a cacheable route', () => {
  it('does not mint the CSRF cookie, so the response stays publicly cacheable', async () => {
    const res = makeRes();
    await runChain([csrfProtection, httpCache('CATEGORY_LIST')], makeReq(), res, { categories: ['a'] });

    expect(hasCsrfCookie(res)).toBe(false);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
    expect(String(res.getHeader('Cache-Control'))).toMatch(/^public\b/);
  });

  it('actually populates the shared cache — second request is a HIT', async () => {
    const mws = [csrfProtection, httpCache('CATEGORY_LIST')];

    const first = makeRes();
    await runChain(mws, makeReq(), first, { categories: ['a'] });
    await new Promise((r) => setTimeout(r, 10)); // write-through is fire-and-forget
    expect(first.getHeader('X-Cache')).toBe('MISS');

    const second = makeRes();
    await runChain(mws, makeReq(), second, { categories: ['SHOULD NOT BE USED'] });
    expect(second.getHeader('X-Cache')).toBe('HIT');
    expect(second.body).toEqual({ categories: ['a'] });
    expect(hasCsrfCookie(second)).toBe(false);
  });
});

describe('requests that must still receive the cookie', () => {
  it('mints it for an authenticated GET and keeps the response private', async () => {
    const res = makeRes();
    const req = makeReq({ headers: { authorization: 'Bearer abc' } });
    await runChain([csrfProtection, httpCache('CATEGORY_LIST')], req, res, { categories: ['a'] });

    expect(hasCsrfCookie(res)).toBe(true);
    expect(String(res.getHeader('Cache-Control'))).toMatch(/^private/);
  });

  it('mints it on a GET to a route with no cache profile', async () => {
    const res = makeRes();
    const req = makeReq({ path: '/api/v1/cart', originalUrl: '/api/v1/cart' });
    await runChain([csrfProtection], req, res, { cart: {} });

    expect(hasCsrfCookie(res)).toBe(true);
  });

  it('mints it immediately on an unsafe method that arrives without one', async () => {
    const res = makeRes();
    const req = makeReq({
      method: 'POST',
      path: '/api/v1/cart/add',
      originalUrl: '/api/v1/cart/add',
    });
    // No cookie + no matching header ⇒ csrf rejects, but the cookie must be set
    // so the client's retry can succeed.
    await new Promise((resolve) => {
      res.status = function (code) { this.statusCode = code; return this; };
      const origJson = res.json.bind(res);
      res.json = function (b) { const out = origJson(b); resolve(); return out; };
      csrfProtection(req, res, resolve);
    });

    expect(hasCsrfCookie(res)).toBe(true);
  });

  it('issues exactly ONE cookie when a handler mints its own (the /csrf-token route)', async () => {
    const res = makeRes();
    const req = makeReq({ path: '/api/v1/csrf-token', originalUrl: '/api/v1/csrf-token' });

    await new Promise((resolve) => {
      const origJson = res.json.bind(res);
      res.json = function (b) { const out = origJson(b); resolve(); return out; };
      csrfProtection(req, res, () => {
        // Handler mints its own token and returns it in the body, exactly as
        // routes/csrfToken.js does.
        res.setHeader('Cache-Control', 'private, no-store');
        const token = setCsrfCookie(res);
        res.json({ csrfToken: token });
      });
    });

    // Two Set-Cookie headers would mean the body token and the cookie disagree.
    expect(res.cookies.filter((c) => c === 'XSRF-TOKEN')).toHaveLength(1);
    const cookieValue = res.getHeader('Set-Cookie')[0].split('=')[1];
    expect(res.body.csrfToken).toBe(cookieValue);
  });

  it('does not re-mint when the client already holds a token', async () => {
    const res = makeRes();
    const req = makeReq({ cookies: { 'XSRF-TOKEN': 'existing' } });
    await runChain([csrfProtection, httpCache('CATEGORY_LIST')], req, res, { categories: ['a'] });

    expect(hasCsrfCookie(res)).toBe(false);
  });
});

/**
 * /products/facets — the route the 2026-08-03 fix missed.
 *
 * It had no cache profile at all, so it emitted no Cache-Control, csrf saw a
 * non-public response and minted XSRF-TOKEN, and Cloudflare will never cache a
 * Set-Cookie response. The filter sidebar hit the origin on every request.
 *
 * Its profile is deliberately `strategy: 'lock'`: getProductFacets owns the Redis
 * entry (canonical key from utils/facetCacheKey.js). These tests pin BOTH halves —
 * the header must be public, and httpCache must NOT start a second store.
 */
describe('/products/facets', () => {
  const facetsReq = (over = {}) => makeReq({
    path: '/api/v1/products/facets',
    originalUrl: '/api/v1/products/facets?brand=Brembo',
    query: { brand: 'Brembo' },
    ...over,
  });

  it('is publicly cacheable and mints no CSRF cookie', async () => {
    const req = facetsReq();
    const res = makeRes();
    await runChain([csrfProtection, httpCache('PRODUCT_FACETS')], req, res, { success: true, facets: {} });

    expect(hasCsrfCookie(res)).toBe(false);
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
    expect(res.getHeader('Cache-Control')).toBe('public, max-age=120, s-maxage=300');
  });

  it('does NOT open a second Redis entry — the controller owns that', async () => {
    const before = cacheService.cache.size;
    const res = makeRes();
    await runChain([csrfProtection, httpCache('PRODUCT_FACETS')], facetsReq(), res, { success: true, facets: {} });

    expect(cacheService.cache.size).toBe(before);
    // Lock profiles leave X-Cache to the controller rather than claiming a MISS
    // for a lookup they never performed.
    expect(res.getHeader('X-Cache')).toBeUndefined();
  });

  it('stays private for an authenticated shopper', async () => {
    const req = facetsReq({ cookies: { accessToken: 'tok' } });
    const res = makeRes();
    await runChain([csrfProtection, httpCache('PRODUCT_FACETS')], req, res, { success: true, facets: {} });

    expect(res.getHeader('Cache-Control')).toBe('private, no-store, no-cache, must-revalidate');
  });

  it('does not edge-cache a 400 from the validator that runs AFTER it', async () => {
    // httpCache is deliberately mounted BEFORE validateProductSearch (matching the
    // /products list route), so a rejected request still passes through it with the
    // public header already applied optimistically. validateRequest answers with
    // res.status(400).json(...), which trips the wrapper's guard and downgrades it.
    const res = makeRes(400);
    await runChain([csrfProtection, httpCache('PRODUCT_FACETS')], facetsReq({ query: { limit: '9999' } }), res, {
      success: false, message: 'Limit must be between 1 and 500',
    });

    expect(res.getHeader('Cache-Control')).toBe('private, no-store, no-cache, must-revalidate');
  });

  it('downgrades to no-store if the handler errors, so an error is never edge-cached', async () => {
    const res = makeRes(500);
    await runChain([csrfProtection, httpCache('PRODUCT_FACETS')], facetsReq(), res, { success: false });

    expect(res.getHeader('Cache-Control')).toBe('private, no-store, no-cache, must-revalidate');
  });
});
