import Redis from 'ioredis';

let redisClient = null;
let redisDownSince = null;
let lastPingTime = 0;
let redisActiveHealth = true;
const HEALTH_CHECK_INTERVAL = 2000;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 5000,
      commandTimeout: 2000,
      tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
    });

    redisClient.on('error', (err) => {
      console.error('[RateLimit] Redis error:', err.message);
      if (!redisDownSince) {
        redisDownSince = Date.now();
        redisActiveHealth = false;
        if (global.Sentry) {
          global.Sentry.captureMessage('Redis unavailable - rate limiting impacted', {
            level: 'error',
            tags: { component: 'rateLimitMiddleware' }
          });
        }
      }
    });

    redisClient.on('ready', () => {
      console.log('[RateLimit] Redis connection established');
      redisDownSince = null;
      redisActiveHealth = true;
    });

    console.log('[RateLimit] Redis client initialised (ioredis / Railway)');
  } catch (err) {
    console.error('[RateLimit] Redis init failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('[RateLimit] ❌ CRITICAL: Redis is required in production but failed to initialize');
      redisActiveHealth = false;
    }
  }
} else {
  console.log('[RateLimit] REDIS_URL not set');
  if (process.env.NODE_ENV === 'production') {
    console.error('[RateLimit] ❌ CRITICAL: REDIS_URL environment variable is required in production');
  }
}

export async function checkRedisHealth() {
  const now = Date.now();
  if (now - lastPingTime < HEALTH_CHECK_INTERVAL) {
    return redisActiveHealth;
  }
  lastPingTime = now;
  try {
    await redisClient.ping();
    redisActiveHealth = true;
    redisDownSince = null;
    return true;
  } catch (err) {
    console.warn(`[RateLimit] Redis health check failed: ${err.message}`);
    redisActiveHealth = false;
    if (!redisDownSince) redisDownSince = Date.now();
    return false;
  }
}

export function isRedisHealthy() {
  return redisActiveHealth && !redisDownSince;
}

export function markRedisDown() {
  if (!redisDownSince) redisDownSince = Date.now();
}

export { redisClient, redisDownSince };
