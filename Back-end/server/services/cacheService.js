/**
 * Cache Service
 *
 * Redis-backed when REDIS_URL is set (production / Railway).
 * Falls back to in-memory Map for local development or when Redis is unavailable.
 *
 * Features:
 * - Time-based expiration
 * - Automatic cleanup of expired in-memory entries
 * - Memory usage monitoring
 * - Cache statistics
 * - Transparent Redis / in-memory switching
 */

import Redis from 'ioredis';

// ── Redis client (lazy – only created when REDIS_URL is present) ────────────
let redisClient = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      // Prevent ioredis from retrying indefinitely on startup failures
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      console.warn('[CacheService] Redis error:', err.message);
    });
    console.log('[CacheService] Redis client initialised (ioredis / Railway)');
  } catch (err) {
    console.warn('[CacheService] Redis init failed – falling back to in-memory cache:', err.message);
    redisClient = null;
  }
} else {
  console.log('[CacheService] REDIS_URL not set – using in-memory cache (single-instance only)');
}

class CacheService {
  constructor() {
    // In-memory fallback store
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };

    // Reduced default TTL: 90 s keeps stale-data window short
    // while Redis is not yet provisioned.
    this.defaultTTL = 90 * 1000;

    // In-memory cleanup (no-op when Redis is active)
    this.startCleanup();
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null if not found/expired
   */
  async get(key) {
    if (redisClient) {
      try {
        const value = await redisClient.get(key);
        if (value === null || value === undefined) {
          this.stats.misses++;
          return null;
        }
        // Upstash returns already-parsed JSON for objects/arrays.
        // For string values that look like JSON, guard against corruption.
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            this.stats.hits++;
            return parsed;
          } catch {
            // Corrupted string in cache — evict and treat as miss
            await redisClient.del(key).catch(() => {});
            this.stats.misses++;
            return null;
          }
        }
        this.stats.hits++;
        return value;
      } catch (err) {
        console.warn('[CacheService] Redis GET error, falling back to memory:', err.message);
      }
    }

    // In-memory fallback
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  async set(key, value, ttl = this.defaultTTL) {
    const ttlSeconds = Math.ceil(ttl / 1000);

    if (redisClient) {
      try {
        // ioredis SET with EX (seconds TTL)
        const serialised = typeof value === 'string' ? value : JSON.stringify(value);
        await redisClient.set(key, serialised, 'EX', ttlSeconds);
        this.stats.sets++;
        return;
      } catch (err) {
        console.warn('[CacheService] Redis SET error, falling back to memory:', err.message);
      }
    }

    // In-memory fallback
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now()
    });
    this.stats.sets++;
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - True if deleted, false if not found
   */
  async delete(key) {
    if (redisClient) {
      try {
        const deleted = await redisClient.del(key);
        if (deleted) this.stats.deletes++;
        return deleted > 0;
      } catch (err) {
        console.warn('[CacheService] Redis DEL error, falling back to memory:', err.message);
      }
    }

    const deleted = this.cache.delete(key);
    if (deleted) this.stats.deletes++;
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    if (redisClient) {
      try {
        await redisClient.flushdb();
        this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
        return;
      } catch (err) {
        console.warn('[CacheService] Redis FLUSHDB error, falling back to memory clear:', err.message);
      }
    }

    this.cache.clear();
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
  }

  /**
   * Clear cache entries matching a pattern
   * @param {string} pattern - Pattern to match
   * @returns {Promise<number>} - Number of keys deleted
   */
  async clearPattern(pattern) {
    if (redisClient) {
      try {
        // ioredis SCAN to find matching keys, then delete in batch
        let cursor = '0';
        const keysToDelete = [];
        do {
          const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', `*${pattern}*`, 'COUNT', '100');
          cursor = nextCursor;
          keysToDelete.push(...keys);
        } while (cursor !== '0');

        if (keysToDelete.length > 0) {
          await redisClient.del(keysToDelete);
          this.stats.deletes += keysToDelete.length;
        }
        return keysToDelete.length;
      } catch (err) {
        console.warn('[CacheService] Redis SCAN/DEL error, falling back to memory clear:', err.message);
      }
    }

    // In-memory fallback
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) keysToDelete.push(key);
    }
    for (const key of keysToDelete) await this.delete(key);
    return keysToDelete.length;
  }

  /**
   * Get cache statistics
   * @returns {object} - Cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * Get approximate memory usage
   * @returns {string} - Memory usage in MB
   */
  getMemoryUsage() {
    let totalSize = 0;
    
    for (const entry of this.cache.values()) {
      // Rough estimation
      totalSize += JSON.stringify(entry.value).length;
    }
    
    return `${(totalSize / 1024 / 1024).toFixed(2)} MB`;
  }

  /**
   * Start automatic cleanup of expired entries
   */
  startCleanup() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Cleanup expired entries
   * @returns {number} - Number of entries removed
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`Cache cleanup: Removed ${removed} expired entries`);
    }
    
    return removed;
  }

  /**
   * Generate cache key for WordPress products
   * @param {string} vehicle - Vehicle slug
   * @param {number} page - Page number
   * @param {number} perPage - Items per page
   * @returns {string} - Cache key
   */
  generateProductCacheKey(vehicle, page, perPage) {
    return `wp:products:${vehicle}:${page}:${perPage}`;
  }

  /**
   * Generate cache key for WordPress categories
   * @returns {string} - Cache key
   */
  generateCategoryCacheKey() {
    return 'wp:categories:all';
  }

  /**
   * Generate cache key for vehicle data
   * @param {string} identifier - Vehicle ID or slug
   * @returns {string} - Cache key
   */
  generateVehicleCacheKey(identifier) {
    return `vehicle:${identifier}`;
  }
}

// Create singleton instance
const cacheService = new CacheService();

// Graceful shutdown cleanup
process.on('SIGINT', () => {
  console.log('Stopping cache cleanup...');
  cacheService.stopCleanup();
});

process.on('SIGTERM', () => {
  console.log('Stopping cache cleanup...');
  cacheService.stopCleanup();
});

export default cacheService;
