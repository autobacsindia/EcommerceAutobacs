import cacheService from '../services/cacheService.js';

/**
 * Cache GET responses by full URL.
 * Skips cache for authenticated requests (user/admin-specific data).
 *
 * @param {number} ttlSeconds - TTL in seconds (default: 300 = 5 min)
 */
export const cacheResponse = (ttlSeconds = 300) => (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  // Skip caching for authenticated requests (user-personalised data)
  if (req.headers.authorization) return next();

  const key = `route:${req.originalUrl}`;
  const cached = cacheService.get(key);

  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Intercept res.json to store the response body before sending
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // cacheService.set() expects milliseconds
      cacheService.set(key, body, ttlSeconds * 1000);
    }
    res.setHeader('X-Cache', 'MISS');
    return originalJson(body);
  };

  next();
};

/**
 * Invalidate all cached routes whose key contains any of the given patterns.
 * Call this in write routes (POST / PUT / PATCH / DELETE) so stale data
 * is never served after a mutation.
 *
 * @param {...string} patterns - Substrings to match against cache keys
 *
 * Usage:
 *   import { invalidateCache } from '../middleware/cacheMiddleware.js';
 *   // inside an async handler after the DB write:
 *   invalidateCache('brands', 'products');
 */
export const invalidateCache = (...patterns) => {
  let total = 0;
  for (const pattern of patterns) {
    total += cacheService.clearPattern(pattern);
  }
  return total;
};
