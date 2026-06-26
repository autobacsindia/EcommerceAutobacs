/**
 * Rate-limit Redis client.
 *
 * Redis split (see plan): rate-limiting does an INCR+TTL on *every* request — high
 * command volume that is costly on Upstash's per-request serverless model. It runs on the
 * dedicated Redis (QUEUE_REDIS_URL, shared with BullMQ), NOT the Upstash cache instance.
 * Falls back to REDIS_URL so single-instance/dev still works.
 *
 * Mirrors the health/circuit-breaker surface of services/redisClient.js so middleware
 * (core.js, emergencyLimiter.js) can consume it unchanged.
 */

import Redis from 'ioredis';
import * as Sentry from '@sentry/node';

const RATE_LIMIT_REDIS_URL = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;

let redisClient = null;
let redisDownSince = null;
let lastPingTime = 0;
let redisActiveHealth = true;
const HEALTH_CHECK_INTERVAL = 2000;

if (RATE_LIMIT_REDIS_URL) {
  try {
    redisClient = new Redis(RATE_LIMIT_REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 5000,
      commandTimeout: 2000,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      },
      tls: RATE_LIMIT_REDIS_URL.startsWith('rediss://') ? {} : undefined,
    });

    redisClient.on('error', (err) => {
      console.error('[Redis:rate-limit] error:', err.message);
      if (!redisDownSince) {
        redisDownSince = Date.now();
        redisActiveHealth = false;
        Sentry.captureMessage('Redis (rate-limit) unavailable', {
          level: 'error',
          tags: { component: 'rateLimitRedisClient' },
        });
      }
    });

    redisClient.on('ready', () => {
      console.log('[Redis:rate-limit] connection ready');
      redisDownSince = null;
      redisActiveHealth = true;
    });

    console.log('[Redis:rate-limit] client initialised');
  } catch (err) {
    console.error('[Redis:rate-limit] init failed:', err.message);
    redisActiveHealth = false;
  }
} else {
  console.log('[Redis:rate-limit] QUEUE_REDIS_URL/REDIS_URL not set');
  if (process.env.NODE_ENV === 'production') {
    console.error('[Redis:rate-limit] CRITICAL: a Redis URL is required in production');
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
    console.warn(`[Redis:rate-limit] health check failed: ${err.message}`);
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
