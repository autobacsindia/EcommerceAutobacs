import cacheService from '../services/cacheService.js';

/**
 * Cache GET responses by full URL.
 * Skips cache for authenticated requests (user/admin-specific data).
 *
 * @param {number} ttlSeconds - TTL in seconds (default: 300 = 5 min)
 */
export const cacheResponse = (ttlSeconds = 300) => async (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  // Skip caching for authenticated requests (user-personalised data)
  if (req.headers.authorization) return next();

  const key = `route:${req.originalUrl}`;
  const cached = await cacheService.get(key);

  if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Intercept res.json to store the response body before sending
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // cacheService.set() expects milliseconds — convert from seconds
      cacheService.set(key, body, ttlSeconds * 1000);
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
  Promise.all(patterns.map((pattern) => cacheService.clearPattern(pattern)))
    .then((counts) => {
      const total = counts.reduce((sum, n) => sum + (n || 0), 0);
      console.log(`[Cache] Invalidated ${total} key(s) for patterns:`, patterns);
    })
    .catch((err) => {
      console.warn(`[Cache] Invalidation failed for patterns: ${patterns.join(', ')}`, err);
    });
};
