/**
 * Route-cache keys must be reachable by the invalidation globs their callers pass.
 *
 * Regression: both middlewares hashed the request into an opaque `route:<md5>` /
 * `public:<md5>` key. `invalidateCache('categories')` globs `*categories*`, which
 * can never match a hex digest — so creating a category left the cached
 * `GET /categories` list serving stale data until its 10-minute TTL expired, and
 * newly-added categories/brands/vehicles never appeared in the admin product form.
 *
 * These tests run against the real CacheService with REDIS_URL unset, which
 * exercises its in-memory Map path — no external Redis is touched.
 */

import { jest } from '@jest/globals';

const { routeNamespace } = await import('../../../utils/cacheKeys.js');
const { default: cacheService } = await import('../../../services/cacheService.js');
const { cacheResponse, invalidateCache } = await import('../../../middleware/cacheMiddleware.js');
const { publicCacheResponse, invalidatePublicCache } = await import('../../../middleware/publicCacheMiddleware.js');

/** Drive a caching middleware to completion and return the key it wrote. */
const primeCache = async (middleware, url, payload) => {
  const req = { method: 'GET', originalUrl: url, query: {}, headers: {} };
  const res = {
    setHeader: jest.fn(),
    statusCode: 200,
    json(body) { this.body = body; return this; },
  };
  await new Promise((resolve) => middleware(req, res, resolve));
  res.json(payload); // middleware wraps res.json to write through to the cache
  // The write-through is fire-and-forget; let its microtasks settle.
  await new Promise((r) => setTimeout(r, 10));
  return req;
};

/** Wait for the fire-and-forget invalidation to drain. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const findKeys = (substring) =>
  [...cacheService.cache.keys()].filter((k) => k.includes(substring));

beforeEach(async () => {
  cacheService.cache.clear();
});

describe('routeNamespace', () => {
  it.each([
    ['/api/v1/categories', 'categories'],
    ['/api/v1/categories?page=1', 'categories'],
    ['/api/v1/products/abc123/similar', 'products'],
    ['/api/v1/vehicles/makes', 'vehicles'],
    ['/api/v2/brands', 'brands'],
  ])('%s → %s', (url, expected) => {
    expect(routeNamespace(url)).toBe(expected);
  });

  it('falls back to a literal when there is no resource segment', () => {
    expect(routeNamespace('/api/v1/')).toBe('misc');
    expect(routeNamespace('')).toBe('misc');
  });

  it('strips glob metacharacters so a path cannot widen an invalidation', () => {
    expect(routeNamespace('/api/v1/*')).toBe('misc');
    expect(routeNamespace('/api/v1/cat*egories')).toBe('categories');
  });
});

describe('invalidateCache reaches route-cached responses', () => {
  it('clears a cached GET /categories when a category is written', async () => {
    await primeCache(cacheResponse(600), '/api/v1/categories', { categories: ['stale'] });

    expect(findKeys('route:categories:')).toHaveLength(1);

    invalidateCache('categories', 'products');
    await settle();

    expect(findKeys('route:categories:')).toHaveLength(0);
  });

  it('does not clear an unrelated resource', async () => {
    await primeCache(cacheResponse(600), '/api/v1/categories', { categories: ['a'] });
    await primeCache(cacheResponse(600), '/api/v1/brands', { brands: ['b'] });

    invalidateCache('categories');
    await settle();

    expect(findKeys('route:categories:')).toHaveLength(0);
    expect(findKeys('route:brands:')).toHaveLength(1);
  });
});

describe('invalidatePublicCache reaches public-cached responses', () => {
  it('clears a cached GET /vehicles when a vehicle is written', async () => {
    await primeCache(publicCacheResponse('VEHICLE_LIST'), '/api/v1/vehicles', { vehicles: ['stale'] });

    expect(findKeys('public:vehicles:')).toHaveLength(1);

    invalidatePublicCache('vehicles');
    await settle();

    expect(findKeys('public:vehicles:')).toHaveLength(0);
  });
});
