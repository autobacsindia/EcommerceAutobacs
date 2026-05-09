import cacheService from '../services/cacheService.js';
import crypto from 'crypto';

/**
 * Generate a cache key that includes query params and context.
 * Designed for public endpoints that don't need user isolation.
 */
const generatePublicCacheKey = (req) => {
  const base = {
    url: req.originalUrl,
    query: req.query,
    // Include locale if present (for i18n support)
    locale: req.headers['accept-language']?.split(',')[0] || 'default',
  };

  return `public:${crypto
    .createHash('md5')
    .update(JSON.stringify(base))
    .digest('hex')}`;
};

/**
 * Cache GET responses for public endpoints with proper key generation.
 * 
 * Features:
 * - Only caches GET requests
 * - Includes query params in cache key
 * - Adds X-Cache header (HIT/MISS) for debugging
 * - Error-safe (won't break if cache fails)
 * - Uses TTL from TTL configuration
 * 
 * @param {string} cacheType - Type of cache to use (e.g., 'PRODUCT_LIST', 'VEHICLE_MAKES')
 */
export const publicCacheResponse = (cacheType) => async (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  // Skip caching for admin routes
  if (req.originalUrl.includes('/admin')) {
    return next();
  }

  // Skip caching for sensitive endpoints
  const skipPaths = ['/auth', '/checkout', '/payment', '/user', '/profile'];
  if (skipPaths.some(path => req.originalUrl.includes(path))) {
    return next();
  }

  // Generate safe cache key
  const key = generatePublicCacheKey(req);

  try {
    const cached = await cacheService.get(key);

    if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  } catch (err) {
    console.warn('[PublicCacheMiddleware] GET error, bypassing cache:', err.message);
    // Continue without caching - don't break the request
  }

  // Intercept res.json to store the response before sending
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Only cache successful responses
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        // Use TTL from configuration
        let ttl = 300; // default 5 minutes
        
        // Map cache types to TTL values
        switch(cacheType) {
          case 'VEHICLE_MAKES':
            ttl = 7200; // 2 hours for vehicle makes (rarely changes)
            break;
          case 'PRODUCT_LIST':
            ttl = 300; // 5 minutes for product list
            break;
          case 'PRODUCT_FEATURED':
            ttl = 3600; // 1 hour for featured products
            break;
          case 'PRODUCT_DETAIL':
            ttl = 120; // 2 minutes for product details (stock changes frequently)
            break;
          case 'PRODUCT_SIMILAR':
            ttl = 120; // 2 minutes for similar products (frequently changes based on stock)
            break;
          case 'PRODUCT_COMPLEMENTARY':
            ttl = 120; // 2 minutes for complementary products (frequently changes based on stock)
            break;
          case 'PRODUCT_SEARCH':
            ttl = 60; // 1 minute for search results
            break;
          default:
            ttl = 300; // default 5 minutes
        }
        
        // cacheService.set() expects milliseconds — convert from seconds
        cacheService.set(key, body, ttl * 1000).catch(err => {
          console.warn('[PublicCacheMiddleware] SET error:', err.message);
        });
      } catch (err) {
        console.warn('[PublicCacheMiddleware] SET error:', err.message);
      }
    }
    
    res.setHeader('X-Cache', 'MISS');
    return originalJson(body);
  };

  next();
};

/**
 * Invalidate all cached routes whose key contains any of the given patterns.
 * Fire-and-forget: does NOT block the HTTP response. Errors are logged but
 * never propagated to the caller.
 * 
 * @param {...string} patterns - Substrings to match against cache keys
 * 
 * Usage:
 *   import { invalidatePublicCache } from '../middleware/publicCacheMiddleware.js';
 *   // inside an async handler after the DB write:
 *   invalidatePublicCache('vehicle-makes', 'products');
 */
export const invalidatePublicCache = (...patterns) => {
  // Run all pattern clears in parallel, fire-and-forget.
  // We intentionally do NOT await so the HTTP response is never delayed.
  Promise.all(patterns.map((pattern) => cacheService.invalidatePattern(pattern)))
    .then((counts) => {
      const total = counts.reduce((sum, n) => sum + (n || 0), 0);
      console.log(`[PublicCache] Invalidated ${total} key(s) for patterns:`, patterns);
    })
    .catch((err) => {
      console.warn(`[PublicCache] Invalidation failed for patterns: ${patterns.join(', ')}`, err);
    });
};
