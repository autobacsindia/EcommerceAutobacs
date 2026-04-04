/**
 * Redis Health Check Middleware
 * 
 * Checks Redis connectivity and adds status to request object.
 * Used by /health endpoint to report Redis status.
 */

import sessionStore from '../services/sessionStore.js';

export const redisHealthCheck = async (req, res, next) => {
  // Only run on health check endpoints
  if (req.path !== '/health' && req.path !== '/ready') {
    return next();
  }
  
  try {
    // Test Redis connectivity via session store
    if (sessionStore.redis) {
      const isHealthy = await sessionStore.isHealthy();
      req.redisHealthy = isHealthy;
      
      if (!isHealthy) {
        console.warn('[HealthCheck] Redis health check failed');
      }
    } else {
      req.redisHealthy = false;
      console.warn('[HealthCheck] Redis client not initialized');
    }
  } catch (err) {
    console.error('[HealthCheck] Redis health check error:', err.message);
    req.redisHealthy = false;
  }
  
  next();
};
