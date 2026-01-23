import cacheService from '../services/cacheService.js';

/**
 * Middleware to cache GET requests
 * @param {number} duration - Cache duration in seconds (default: 300s / 5m)
 */
export const cacheResponse = (duration = 300) => (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Skip caching if authenticated (admin/user specific data)
  if (req.headers.authorization) {
    return next();
  }

  // Generate cache key based on URL
  const key = `route:${req.originalUrl}`;
  
  const cachedResponse = cacheService.get(key);

  if (cachedResponse) {
    // Add header to indicate cached response
    res.setHeader('X-Cache', 'HIT');
    return res.json(cachedResponse);
  }

  // Override res.json to cache the response before sending
  const originalJson = res.json;
  res.json = function (body) {
    // Only cache successful responses
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cacheService.set(key, body, duration * 1000); // Convert to ms
    }
    res.setHeader('X-Cache', 'MISS');
    return originalJson.call(this, body);
  };

  next();
};
