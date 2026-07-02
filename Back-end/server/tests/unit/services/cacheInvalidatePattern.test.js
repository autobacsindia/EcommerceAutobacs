import { jest } from '@jest/globals';

// Force the in-memory cache path (no Redis) so invalidatePattern operates on
// the local Map deterministically.
jest.unstable_mockModule('../../../services/cache/redisClient.js', () => ({
  redisClient: null,
  getRedisClient: () => null,
}));

const { default: CacheService } = await import('../../../services/cache/CacheService.js');
const cacheService = new CacheService();

describe('CacheService pattern invalidation (substring contract)', () => {
  describe('matchesPattern', () => {
    it('treats a bare word as a substring, not an anchored match', () => {
      // The bug: `^products$` only matched a key literally named "products",
      // so real keys like "v2:products:facets:{}" were never invalidated.
      expect(cacheService.matchesPattern('v2:products:facets:{}', 'products')).toBe(true);
      expect(cacheService.matchesPattern('v2:products:list:{}', 'products')).toBe(true);
      expect(cacheService.matchesPattern('v2:categories:tree', 'categories')).toBe(true);
    });

    it('does not match unrelated keys', () => {
      expect(cacheService.matchesPattern('v2:categories:tree', 'products')).toBe(false);
      expect(cacheService.matchesPattern('route:abc123', 'products')).toBe(false);
    });

    it('still honours explicit * wildcards', () => {
      expect(cacheService.matchesPattern('v2:products:facets:{}', 'v2:products:*')).toBe(true);
      expect(cacheService.matchesPattern('v2:brands:list', 'v2:products:*')).toBe(false);
    });

    it('escapes regex metacharacters in the pattern', () => {
      // A '.' in the pattern must match a literal dot, not any char.
      expect(cacheService.matchesPattern('v2:a.b', 'a.b')).toBe(true);
      expect(cacheService.matchesPattern('v2:axb', 'a.b')).toBe(false);
    });
  });

  describe('invalidatePattern (in-memory)', () => {
    it('removes every key that contains the pattern and returns the count', async () => {
      cacheService.cache.set('v2:products:facets:{}', { value: 1, expiry: Date.now() + 60000 });
      cacheService.cache.set('v2:products:list:{}', { value: 1, expiry: Date.now() + 60000 });
      cacheService.cache.set('v2:categories:tree', { value: 1, expiry: Date.now() + 60000 });

      const removed = await cacheService.invalidatePattern('products');

      expect(removed).toBe(2);
      expect(cacheService.cache.has('v2:products:facets:{}')).toBe(false);
      expect(cacheService.cache.has('v2:products:list:{}')).toBe(false);
      expect(cacheService.cache.has('v2:categories:tree')).toBe(true);
    });
  });
});
