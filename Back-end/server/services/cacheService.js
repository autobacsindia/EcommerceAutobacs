/**
 * Enhanced Cache Service - Production Hardened
 * 
 * Features:
 * - Tag-based invalidation
 * - Cache metrics & observability  
 * - SWR with backpressure control
 * - Centralized TTL config
 * - Failure fallback strategies
 * - Pattern-based invalidation
 */

import Redis from 'ioredis';

// ── TTL Configuration (centralized) ─────────────────────────────────────────
export const TTL = {
  // Products
  PRODUCT_DETAIL: 3600,        // 1 hour
  PRODUCT_LIST: 300,           // 5 minutes
  PRODUCT_SEARCH: 60,          // 1 minute
  PRODUCT_FEATURED: 3600,      // 1 hour
  PRODUCT_OFFERS: 1800,        // 30 minutes
  
  // Categories & Brands
  CATEGORIES: 7200,            // 2 hours
  BRANDS: 7200,                // 2 hours
  
  // User data
  USER_PROFILE: 300,           // 5 minutes
  USER_CART: 60,               // 1 minute
  
  // Inventory (critical accuracy)
  INVENTORY: 60,               // 1 minute
  
  // Search
  SEARCH_SUGGESTIONS: 300,     // 5 minutes
};

// ── Redis client ────────────────────────────────────────────────────────────
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

class CacheService {
  constructor() {
    this.cache = new Map();
    
    // Tag-based invalidation
    this.tagMap = new Map(); // tag -> Set<keys>
    this.keyTags = new Map(); // key -> Set<tags>
    
    // Metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      tagInvalidations: 0,
      patternInvalidations: 0,
      stalenessServed: 0,
      stampedePrevented: 0,
      fallbackToDB: 0,
      fallbackToStale: 0
    };

    this.defaultTTL = 90 * 1000;
    this.startCleanup();
  }

  // ── Core Methods ──────────────────────────────────────────────────────────

  generateKey(prefix, params = {}) {
    const parts = [prefix];
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        parts.push(`${key}=${value}`);
      }
    }
    return parts.join(':');
  }

  async wrap(key, fn, options = {}) {
    const { ttl = 300, strategy = 'basic', tags = [] } = options;
    
    try {
      if (strategy === 'swr') {
        return this.getStaleWhileRevalidateWithLock(key, fn, ttl, tags);
      }
      
      if (strategy === 'lock') {
        return this.getWithLock(key, fn, ttl, tags);
      }
      
      // Basic strategy
      const cached = await this.get(key);
      if (cached) return cached;
      
      const result = await fn();
      await this.set(key, result, ttl, tags);
      return result;
    } catch (error) {
      this.metrics.errors++;
      console.error(`[CacheService] wrap error for ${key}:`, error.message);
      throw error;
    }
  }

  async get(key) {
    try {
      if (redisClient) {
        const value = await redisClient.get(key);
        if (value === null || value === undefined) {
          this.metrics.misses++;
          return null;
        }
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            this.metrics.hits++;
            return parsed;
          } catch {
            await redisClient.del(key).catch(() => {});
            this.metrics.misses++;
            return null;
          }
        }
        this.metrics.hits++;
        return value;
      }

      const entry = this.cache.get(key);
      if (!entry) {
        this.metrics.misses++;
        return null;
      }
      if (Date.now() > entry.expiry) {
        this.cache.delete(key);
        this.metrics.misses++;
        return null;
      }
      this.metrics.hits++;
      return entry.value;
    } catch (error) {
      this.metrics.errors++;
      console.warn('[CacheService] GET error:', error.message);
      return null;
    }
  }

  async set(key, value, ttl = 300, tags = []) {
    try {
      if (redisClient) {
        await redisClient.set(key, JSON.stringify(value), 'EX', ttl);
      } else {
        this.cache.set(key, {
          value,
          expiry: Date.now() + (ttl * 1000)
        });
      }

      // Track tags
      if (tags.length > 0) {
        this.trackTags(key, tags);
      }

      this.metrics.sets++;
    } catch (error) {
      this.metrics.errors++;
      console.warn('[CacheService] SET error:', error.message);
    }
  }

  async delete(key) {
    try {
      if (redisClient) {
        await redisClient.del(key);
      } else {
        this.cache.delete(key);
      }

      // Clean up tags
      this.untrackTags(key);
      this.metrics.deletes++;
    } catch (error) {
      this.metrics.errors++;
      console.warn('[CacheService] DELETE error:', error.message);
    }
  }

  // ── Tag-Based Invalidation ────────────────────────────────────────────────

  trackTags(key, tags) {
    for (const tag of tags) {
      if (!this.tagMap.has(tag)) {
        this.tagMap.set(tag, new Set());
      }
      this.tagMap.get(tag).add(key);

      if (!this.keyTags.has(key)) {
        this.keyTags.set(key, new Set());
      }
      this.keyTags.get(key).add(tag);
    }
  }

  untrackTags(key) {
    const tags = this.keyTags.get(key);
    if (tags) {
      for (const tag of tags) {
        this.tagMap.get(tag)?.delete(key);
      }
      this.keyTags.delete(key);
    }
  }

  async invalidateTag(tag) {
    const keys = this.tagMap.get(tag);
    if (!keys || keys.size === 0) return;

    console.log(`[CacheService] Invalidating tag '${tag}': ${keys.size} keys`);

    const deletePromises = Array.from(keys).map(key => this.delete(key));
    await Promise.all(deletePromises);

    this.metrics.tagInvalidations++;
  }

  // ── Pattern-Based Invalidation ────────────────────────────────────────────

  async invalidatePattern(pattern) {
    console.log(`[CacheService] Invalidating pattern: ${pattern}`);

    if (redisClient) {
      // Use SCAN for production-safe pattern matching
      let cursor = '0';
      const keys = [];
      
      do {
        const result = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');

      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } else {
      // In-memory fallback
      for (const key of this.cache.keys()) {
        if (this.matchesPattern(key, pattern)) {
          await this.delete(key);
        }
      }
    }

    this.metrics.patternInvalidations++;
  }

  matchesPattern(key, pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(key);
  }

  // ── SWR with Backpressure Control ─────────────────────────────────────────

  async getStaleWhileRevalidateWithLock(key, fn, ttl, tags = [], staleWindow = 60) {
    const cached = await this.get(key);
    
    if (cached) {
      // Serve stale + revalidate in background (with lock to prevent thundering herd)
      this.metrics.stalenessServed++;
      this.revalidateWithLock(key, fn, ttl, tags).catch(err => {
        console.warn(`[CacheService] Background revalidation failed:`, err.message);
      });
      return cached;
    }
    
    // Cache miss - fetch with lock
    return this.getWithLock(key, fn, ttl, tags);
  }

  async revalidateWithLock(key, fn, ttl, tags) {
    const lockKey = `${key}:lock`;
    const acquired = await this.acquireLock(lockKey, 5000);
    
    if (!acquired) {
      return; // Another request is already revalidating
    }

    try {
      const result = await fn();
      await this.set(key, result, ttl, tags);
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // ── Cache with Lock (Stampede Protection) ─────────────────────────────────

  async getWithLock(key, fn, ttl, tags = [], lockTimeout = 5000) {
    const cached = await this.get(key);
    if (cached) return cached;
    
    const lockKey = `${key}:lock`;
    const acquired = await this.acquireLock(lockKey, lockTimeout);
    
    if (!acquired) {
      // Another request is fetching - wait and retry
      this.metrics.stampedePrevented++;
      await this.sleep(100);
      return this.getWithLock(key, fn, ttl, tags, lockTimeout);
    }
    
    try {
      const result = await fn();
      await this.set(key, result, ttl, tags);
      return result;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async acquireLock(lockKey, timeout) {
    if (redisClient) {
      const acquired = await redisClient.set(lockKey, '1', 'PX', timeout, 'NX');
      return acquired === 'OK';
    }
    
    if (!this.cache.has(lockKey)) {
      this.cache.set(lockKey, Date.now() + timeout);
      return true;
    }
    
    const expiry = this.cache.get(lockKey);
    if (Date.now() > expiry) {
      this.cache.delete(lockKey);
      this.cache.set(lockKey, Date.now() + timeout);
      return true;
    }
    
    return false;
  }

  async releaseLock(lockKey) {
    if (redisClient) {
      await redisClient.del(lockKey);
    } else {
      this.cache.delete(lockKey);
    }
  }

  // ── Metrics & Observability ───────────────────────────────────────────────

  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? (this.metrics.hits / total * 100).toFixed(2) : 0;

    return {
      ...this.metrics,
      hitRate: `${hitRate}%`,
      totalRequests: total,
      cacheSize: redisClient ? 'redis' : this.cache.size
    };
  }

  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      tagInvalidations: 0,
      patternInvalidations: 0,
      stalenessServed: 0,
      stampedePrevented: 0,
      fallbackToDB: 0,
      fallbackToStale: 0
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  startCleanup() {
    if (redisClient) return;
    
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiry) {
          this.cache.delete(key);
        }
      }
    }, 60000);
  }
}

export default new CacheService();
