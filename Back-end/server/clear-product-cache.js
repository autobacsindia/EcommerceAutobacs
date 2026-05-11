/**
 * Clear ALL Redis cache keys related to products
 */

import Redis from 'ioredis';

async function clearProductCache() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('REDIS_URL not found in environment');
    process.exit(1);
  }
  
  console.log(`[Redis] Connecting to ${redisUrl}...`);
  
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000
  });

  try {
    // Find all product-related cache keys
    const patterns = [
      'cache:products*',
      'cache:product:*',
      'cache:public*',
      'rate_limit:*'
    ];
    
    let totalDeleted = 0;
    
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      console.log(`[Redis] Found ${keys.length} keys matching "${pattern}"`);
      
      if (keys.length > 0) {
        const deleted = await redis.del(keys);
        console.log(`[Redis] Deleted ${deleted} keys`);
        totalDeleted += deleted;
        
        // Show first 5 keys for verification
        keys.slice(0, 5).forEach(key => {
          console.log(`  - ${key}`);
        });
        if (keys.length > 5) {
          console.log(`  ... and ${keys.length - 5} more`);
        }
      }
      console.log('');
    }
    
    console.log(`\n[Redis] Total keys deleted: ${totalDeleted}`);
    console.log('[Redis] Cache cleared successfully!');
    
  } catch (error) {
    console.error('[Redis] Error:', error);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

clearProductCache();
