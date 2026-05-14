import Redis from 'ioredis';

let redisClient = null;

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
      console.warn('[CacheService] Redis error:', err.message);
    });
    console.log('[CacheService] Redis client initialised');
  } catch (err) {
    console.warn('[CacheService] Redis init failed – using in-memory:', err.message);
    redisClient = null;
  }
} else {
  console.log('[CacheService] REDIS_URL not set – using in-memory cache');
}

export { redisClient };

export function getRedisClient() {
  return redisClient;
}
