import cacheService from '../services/cacheService.js';
import crypto from 'crypto';

/**
 * Generate a cache key that includes query params and user context.
 * Prevents data leakage between users and ensures correct caching.
 */
const generateCacheKey = (req) => {
  const base = {
    url: req.originalUrl,
    query: req.query,
    // Include user ID to prevent data leakage between authenticated users
    user: req.user?.id || 'guest',
    // Include locale if present (for i18n support)
    locale: req.headers['accept-language']?.split(',')[0] || 'default',
  };

  return `route:${crypto
    .createHash('md5')
    .update(JSON.stringify(base))
    .digest('hex')}`;
};

/**
 * Cache GET responses with proper key generation and user isolation.
 * 
 * Features:
 * - Only caches GET requests
 * - Skips authenticated requests (prevents data leakage)
 * - Skips admin routes
 * - Includes query params in cache key
 * - Includes user context in cache key
 * - Adds X-Cache header (HIT/MISS) for debugging
 * - Error-safe (won't break if cache fails)
 *
 * @param {number} ttlSeconds - TTL in seconds (default: 300 = 5 min)
 */
export const cacheResponse = (ttlSeconds = 300) => async (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  // Skip caching for authenticated requests (user-specific data)
  if (req.headers.authorization || req.user) {
    return next();
  }

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
  const key = generateCacheKey(req);

  try {
    const cached = await cacheService.get(key);

    if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  } catch (err) {
    console.warn('[CacheMiddleware] GET error, bypassing cache:', err.message);
    // Continue without caching - don't break the request
  }

  // Intercept res.json to store the response before sending
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Only cache successful responses
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        // cacheService.set() expects milliseconds — convert from seconds
        cacheService.set(key, body, ttlSeconds * 1000).catch(err => {
          console.warn('[CacheMiddleware] SET error:', err.message);
        });
      } catch (err) {
        console.warn('[CacheMiddleware] SET error:', err.message);
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
 *   import { invalidateCache } from '../middleware/cacheMiddleware.js';
 *   // inside an async handler after the DB write:
 *   invalidateCache('brands', 'products');
 */
export const invalidateCache = (...patterns) => {
  // Run all pattern clears in parallel, fire-and-forget.
  // We intentionally do NOT await so the HTTP response is never delayed.
  Promise.all(patterns.map((pattern) => cacheService.invalidatePattern(pattern)))
    .then((counts) => {
      const total = counts.reduce((sum, n) => sum + (n || 0), 0);
      console.log(`[Cache] Invalidated ${total} key(s) for patterns:`, patterns);
    })
    .catch((err) => {
      console.warn(`[Cache] Invalidation failed for patterns: ${patterns.join(', ')}`, err);
    });
};
