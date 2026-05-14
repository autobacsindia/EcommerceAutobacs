import rateLimitEventEmitter from '../../services/rateLimitEventEmitter.js';
import adaptiveThrottlingService from '../../services/adaptiveThrottlingService.js';
import { redisClient, checkRedisHealth, markRedisDown } from './redisClient.js';
import { handleRedisUnavailable } from './emergencyLimiter.js';
import { isValidIP } from './ipValidator.js';

export const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    burst = null,
    message = 'Too many requests, please try again later',
    keyGenerator,
    handler = null
  } = options;

  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();

    const clientIP = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    if (!isValidIP(clientIP)) {
      console.warn(`[RateLimit] Invalid IP detected: ${clientIP}`);
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const healthy = await checkRedisHealth();
    if (!healthy) return handleRedisUnavailable(req, res, next);

    const endpoint = req.originalUrl || req.url;
    const adjustedMax = adaptiveThrottlingService.getAdjustedLimit(endpoint, max);
    const effectiveMax = adjustedMax;

    const baseKey = keyGenerator
      ? keyGenerator(req)
      : req.user?.id || req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;

    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);

    try {
      const redisKey = `rl:${baseKey}`;
      const count = await redisClient.incr(redisKey);
      if (count === 1) {
        try {
          await redisClient.expire(redisKey, windowSec);
        } catch (expireErr) {
          await redisClient.del(redisKey).catch(() => {});
          console.warn('[RateLimit] expire failed, key deleted to prevent permanent block:', expireErr.message);
          return next();
        }
      }

      const ttl = count === 1 ? windowSec : await redisClient.ttl(redisKey);
      const resetTime = now + ttl * 1000;

      res.set('X-RateLimit-Limit', effectiveMax.toString());
      res.set('X-RateLimit-Remaining', Math.max(0, effectiveMax - count).toString());
      res.set('X-RateLimit-Reset', new Date(resetTime).toISOString());

      if (count > effectiveMax) {
        const retryAfter = ttl > 0 ? ttl : 1;
        rateLimitEventEmitter.emitBlock({
          endpoint,
          method: req.method,
          ipAddress: req.ip || req.connection.remoteAddress,
          userId: req.user?.id || req.user?._id,
          userEmail: req.user?.email,
          limitType: 'window',
          currentLimit: effectiveMax,
          attemptCount: count,
          retryAfter,
          userAgent: req.get('user-agent'),
          deviceInfo: req.get('user-agent'),
          adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
        });

        res.set('Retry-After', retryAfter.toString());
        res.set('X-RateLimit-Remaining', '0');

        if (handler) return handler(req, res);
        return res.status(429).json({
          success: false,
          message,
          rateLimitInfo: { retryAfter, resetTime, type: 'window' }
        });
      }

      rateLimitEventEmitter.emitHit({
        endpoint,
        method: req.method,
        ipAddress: req.ip || req.connection.remoteAddress,
        userId: req.user?.id || req.user?._id,
        userEmail: req.user?.email,
        limitType: 'window',
        currentLimit: effectiveMax,
        attemptCount: count,
        userAgent: req.get('user-agent'),
        deviceInfo: req.get('user-agent'),
        adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
      });

      return next();
    } catch (err) {
      console.error('[RateLimit] Redis error during rate limit check:', err.message);
      markRedisDown();
      return handleRedisUnavailable(req, res, next);
    }
  };
};
