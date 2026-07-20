/**
 * Write-path invalidation reaches every cached response for a resource, and
 * only that resource.
 *
 * Post-overhaul: cacheable routes are cached by middleware/httpCache.js under
 * `v3:resp:<ns>:<md5>` keys filed in the tag index, and invalidateCache /
 * invalidatePublicCache clear by tag (with a SCAN-glob fallback for any legacy
 * or untagged key). These tests run against the real CacheService with
 * REDIS_URL unset — its in-memory Map + tagMap path — so no Redis is touched.
 */

import { jest } from '@jest/globals';

const { routeNamespace } = await import('../../../utils/cacheKeys.js');
const { default: cacheService } = await import('../../../services/cacheService.js');
const { httpCache } = await import('../../../middleware/httpCache.js');
const { invalidateCache } = await import('../../../middleware/cacheMiddleware.js');
const { invalidatePublicCache } = await import('../../../middleware/publicCacheMiddleware.js');

/** Drive httpCache to completion so it writes the response through to the cache. */
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
  res.json(payload); // httpCache wrapped res.json to write through
  await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget set settle
};

/** Wait for the fire-and-forget invalidation to drain. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const findKeys = (substring) =>
  [...cacheService.cache.keys()].filter((k) => k.includes(substring));

beforeEach(() => {
  cacheService.cache.clear();
  cacheService.tagMap.clear();
  cacheService.keyTags.clear();
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

describe('invalidateCache reaches cached responses by tag', () => {
  it('clears a cached GET /categories when a category is written', async () => {
    await primeCache('CATEGORY_LIST', '/api/v1/categories', { categories: ['stale'] });
    expect(findKeys('resp:categories:')).toHaveLength(1);

    invalidateCache('categories', 'products');
    await settle();

    expect(findKeys('resp:categories:')).toHaveLength(0);
  });

  it('does not clear an unrelated resource', async () => {
    await primeCache('CATEGORY_LIST', '/api/v1/categories', { categories: ['a'] });
    await primeCache('BRAND_LIST', '/api/v1/brands', { brands: ['b'] });

    invalidateCache('categories');
    await settle();

    expect(findKeys('resp:categories:')).toHaveLength(0);
    expect(findKeys('resp:brands:')).toHaveLength(1);
  });
});

describe("a single 'products' invalidation clears every product cache layer", () => {
  it('clears httpCache detail entries AND service-layer product keys', async () => {
    // httpCache-stored product detail (tagged 'products' + per-entity).
    await primeCache('PRODUCT_DETAIL', '/api/v1/products/slug/x', { success: true, product: { _id: 'p', slug: 'x' } });
    // Service-layer key (productService.wrap style): tagged 'products'.
    await cacheService.set('v3:default:product:{"slug":"x"}', { product: 'stale' }, 300, ['products']);
    // A legacy/untagged key that only the SCAN-glob fallback can reach.
    await cacheService.set('v2:products:list:{"page":"1"}', { products: ['stale'] }, 300);

    expect(findKeys('product')).toHaveLength(3);

    invalidatePublicCache('products');
    await settle();

    expect(findKeys('product')).toHaveLength(0);
  });

  it('leaves non-product caches untouched', async () => {
    await primeCache('VEHICLE_LIST', '/api/v1/vehicles', { vehicles: ['keep'] });
    await primeCache('PRODUCT_DETAIL', '/api/v1/products/slug/y', { success: true, product: { _id: 'q', slug: 'y' } });

    invalidatePublicCache('products');
    await settle();

    expect(findKeys('resp:products:')).toHaveLength(0);
    expect(findKeys('resp:vehicles:')).toHaveLength(1);
  });
});

describe('invalidatePublicCache reaches cached responses by tag', () => {
  it('clears a cached GET /vehicles when a vehicle is written', async () => {
    await primeCache('VEHICLE_LIST', '/api/v1/vehicles', { vehicles: ['stale'] });
    expect(findKeys('resp:vehicles:')).toHaveLength(1);

    invalidatePublicCache('vehicles');
    await settle();

    expect(findKeys('resp:vehicles:')).toHaveLength(0);
  });
});
