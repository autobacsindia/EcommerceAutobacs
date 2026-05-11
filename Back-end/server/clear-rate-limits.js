/**
 * Clear all rate limit keys from Redis
 * Run this when getting 429 errors in development
 */

import Redis from 'ioredis';

async function clearRateLimits() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  console.log(`[Redis] Connecting to ${redisUrl}...`);
  
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000
  });

  try {
    // Find all rate limit keys
    const keys = await redis.keys('rate_limit:*');
    
    console.log(`[Redis] Found ${keys.length} rate limit keys`);
    
    if (keys.length > 0) {
      // Delete all rate limit keys
      const deleted = await redis.del(keys);
      console.log(`[Redis] Deleted ${deleted} rate limit keys`);
      console.log('[Redis] Rate limits cleared successfully!');
    } else {
      console.log('[Redis] No rate limit keys found');
    }
  } catch (error) {
    console.error('[Redis] Error clearing rate limits:', error);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

clearRateLimits();
