import Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { redisTransportOptions, redisRetryStrategy } from '../utils/redisTransport.js';

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
      // Never give up reconnecting — see redisRetryStrategy.
      retryStrategy: redisRetryStrategy,
      ...redisTransportOptions(process.env.REDIS_URL),
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] error:', err.message);
      if (!redisDownSince) {
        redisDownSince = Date.now();
        redisActiveHealth = false;
        Sentry.captureMessage('Redis unavailable', {
          level: 'error',
          tags: { component: 'redisClient' },
        });
      }
    });

    redisClient.on('ready', () => {
      console.log('[Redis] connection ready');
      redisDownSince = null;
      redisActiveHealth = true;
    });

    console.log('[Redis] client initialised');
  } catch (err) {
    console.error('[Redis] init failed:', err.message);
    redisActiveHealth = false;
  }
} else {
  console.log('[Redis] REDIS_URL not set');
  if (process.env.NODE_ENV === 'production') {
    console.error('[Redis] CRITICAL: REDIS_URL is required in production');
  }
}

export async function checkRedisHealth() {
  const now = Date.now();
  if (now - lastPingTime < HEALTH_CHECK_INTERVAL) return redisActiveHealth;
  lastPingTime = now;
  try {
    await redisClient.ping();
    redisActiveHealth = true;
    redisDownSince = null;
    return true;
  } catch (err) {
    console.warn(`[Redis] health check failed: ${err.message}`);
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

export function getRedisClient() {
  return redisClient;
}

export { redisClient, redisDownSince };
