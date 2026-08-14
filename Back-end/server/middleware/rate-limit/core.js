import rateLimitEventEmitter from '../../services/rateLimitEventEmitter.js';
import adaptiveThrottlingService from '../../services/adaptiveThrottlingService.js';
import { redisClient, checkRedisHealth, markRedisDown } from './redisClient.js';
import { handleRedisUnavailable } from './emergencyLimiter.js';
import { isValidIP } from './ipValidator.js';
import { isTrustedInternalClient, getInternalRateMultiplier } from './trustedClient.js';
import { normalizeEndpoint } from '../../config/rateLimitTelemetry.js';

// Atomic fixed-window counter in a SINGLE Redis round-trip.
//   KEYS[1] = counter key, ARGV[1] = window seconds → returns {count, ttl}.
// Collapses the former INCR + EXPIRE + TTL (2–3 sequential round-trips) into one
// call — the round-trip count is what dominates latency when the rate-limit
// Redis is a network hop from the app. `if t < 0` (re)applies the window
// whenever the key has no expiry, covering both the first increment and any
// "key lost its TTL" case, so a counter can never get stuck without a reset
// (the guarantee the old del-on-expire-failure branch provided).
const RATE_LIMIT_LUA = `
local c = redis.call('INCR', KEYS[1])
local t = redis.call('TTL', KEYS[1])
if t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}
`;

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
    // Telemetry records the path only. `endpoint` keeps its full-URL form above so
    // adaptive-throttling lookups are untouched by this change.
    const endpointPath = normalizeEndpoint(endpoint);

    // Our own frontend calling server-side (SSR/ISR) arrives from a handful of
    // Vercel egress IPs and would otherwise share one per-IP bucket across the
    // whole fleet. Give it a separate, much larger bucket. See trustedClient.js.
    const isInternal = isTrustedInternalClient(req);
    const effectiveMax = isInternal ? adjustedMax * getInternalRateMultiplier() : adjustedMax;

    const rawKey = keyGenerator
      ? keyGenerator(req)
      : req.user?.id || req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    // Namespaced separately so internal traffic can never exhaust — or be
    // throttled by — a real visitor's counter, and stays visible in Redis.
    const baseKey = isInternal ? `internal:${rawKey}` : rawKey;

    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);

    try {
      const redisKey = `rl:${baseKey}`;
      // One atomic round-trip: increment, ensure the window TTL, read it back.
      const [count, ttl] = await redisClient.eval(RATE_LIMIT_LUA, 1, redisKey, windowSec);
      const resetTime = now + ttl * 1000;

      res.set('X-RateLimit-Limit', effectiveMax.toString());
      res.set('X-RateLimit-Remaining', Math.max(0, effectiveMax - count).toString());
      res.set('X-RateLimit-Reset', new Date(resetTime).toISOString());

      if (count > effectiveMax) {
        const retryAfter = ttl > 0 ? ttl : 1;
        rateLimitEventEmitter.emitBlock({
          endpoint: endpointPath,
          method: req.method,
          // Same IP the limiter keys on (clientIP prefers cf-connecting-ip).
          // Recording req.ip here logged the Vercel/proxy egress address, which
          // made block events useless for tracing an abusive client.
          ipAddress: clientIP,
          userId: req.user?.id || req.user?._id,
          userEmail: req.user?.email,
          limitType: 'window',
          currentLimit: effectiveMax,
          attemptCount: count,
          retryAfter,
          userAgent: req.get('user-agent'),
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
        endpoint: endpointPath,
        method: req.method,
        ipAddress: clientIP,
        userId: req.user?.id || req.user?._id,
        userEmail: req.user?.email,
        limitType: 'window',
        currentLimit: effectiveMax,
        attemptCount: count,
        userAgent: req.get('user-agent'),
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
