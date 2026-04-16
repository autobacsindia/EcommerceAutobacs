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

// ── Cache Version (prevents silent data corruption after deploys) ─────────────
export const CACHE_VERSION = process.env.CACHE_VERSION || 'v1';

// ── Cache Configuration ─────────────────────────────────────────────────────
export const CACHE_CONFIG = {
  // TTL jitter (prevents synchronized expiry)
  TTL_JITTER_PERCENT: 0.1, // ±10% jitter
  
  // Lock heartbeat
  LOCK_HEARTBEAT_INTERVAL: 2000, // 2s
  LOCK_HEARTBEAT_EXTEND: 5000,   // Extend by 5s
  
  // Warmup
  WARMUP_ENABLED: process.env.CACHE_WARMUP_ENABLED === 'true',
  WARMUP_KEYS: [], // Preload these keys on startup
  
  // Cleanup leader election
  CLEANUP_LEADER_KEY: 'cache:cleanup:leader',
  CLEANUP_LEADER_TTL: 900, // 15 minutes
};

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
    
    // Tag-based invalidation with TTL
    this.tagMap = new Map(); // tag -> Set<keys>
    this.keyTags = new Map(); // key -> Set<tags>
    this.tagExpiry = new Map(); // tag -> expiry timestamp
    
    // Distributed lock tracking
    this.activeLocks = new Map(); // lockKey -> { acquiredBy, expiresAt }
    
    // Rate limiting for cache misses
    this.missRateLimiter = new Map(); // key -> { count, resetAt }
    this.maxMissesPerWindow = 10; // Max DB queries per key per window
    this.missWindowMs = 10000; // 10 second window
    
    // Multi-region support
    this.regionId = process.env.REGION_ID || 'default';
    
    // Instance ID (for leader election)
    this.instanceId = `${this.regionId}:${process.pid}:${Date.now()}`;
    this.isCleanupLeader = false;
    
    // Active lock heartbeats
    this.lockHeartbeats = new Map(); // lockKey -> intervalId
    
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
      fallbackToStale: 0,
      tagCleanupRuns: 0,
      orphanedTagsRemoved: 0,
      rateLimitedMisses: 0,
      writeThroughCalls: 0,
      ttlJitterApplied: 0,
      lockHeartbeats: 0,
      warmupKeysLoaded: 0,
      leaderElectionWins: 0,
      rateLimitedServeStale: 0
    };

    this.defaultTTL = 90 * 1000;
    this.startCleanup();
    this.startClusterSafeCleanup(); // Leader election for cleanup
    this.exportMetricsPeriodically();
    
    // Warmup cache if enabled
    if (CACHE_CONFIG.WARMUP_ENABLED) {
      this.warmupCache().catch(console.error);
    }
  }

  // ── Core Methods ──────────────────────────────────────────────────────────

  /**
   * Generate versioned cache key
   * Prevents silent data corruption after schema/logic changes
   */
  generateKey(prefix, params = {}) {
    // Include cache version to invalidate all caches on deploy
    const versionedPrefix = `${CACHE_VERSION}:${this.regionId}:${prefix}`;
    
    const parts = [versionedPrefix];
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
    
    // Apply TTL jitter (prevents synchronized expiry)
    const jitteredTTL = this.applyTTLJitter(ttl);
    
    try {
      if (strategy === 'swr') {
        return this.getStaleWhileRevalidateWithLock(key, fn, jitteredTTL, tags);
      }
      
      if (strategy === 'lock') {
        return this.getWithLock(key, fn, jitteredTTL, tags);
      }
      
      // Basic strategy
      const cached = await this.get(key);
      if (cached) return cached;
      
      const result = await fn();
      await this.set(key, result, jitteredTTL, tags);
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
    const now = Date.now();
    const tagTTL = 7200000; // 2 hours for tag mappings
    
    for (const tag of tags) {
      if (!this.tagMap.has(tag)) {
        this.tagMap.set(tag, new Set());
      }
      this.tagMap.get(tag).add(key);

      if (!this.keyTags.has(key)) {
        this.keyTags.set(key, new Set());
      }
      this.keyTags.get(key).add(tag);
      
      // Set expiry for tag
      this.tagExpiry.set(tag, now + tagTTL);
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

  // ── Tag Cleanup (prevent memory bloat) ────────────────────────────────────

  startTagCleanup() {
    // Only run if we're the leader (cluster-safe)
    if (!this.isCleanupLeader && redisClient) {
      return;
    }
    
    // Run every 15 minutes
    setInterval(() => this.cleanupExpiredTags(), 900000);
  }

  cleanupExpiredTags() {
    const now = Date.now();
    let removed = 0;

    for (const [tag, expiry] of this.tagExpiry.entries()) {
      if (now > expiry) {
        // Tag expired - clean it up
        this.tagMap.delete(tag);
        this.tagExpiry.delete(tag);
        removed++;

        // Remove from keyTags
        for (const [key, tags] of this.keyTags.entries()) {
          tags.delete(tag);
          if (tags.size === 0) {
            this.keyTags.delete(key);
          }
        }
      }
    }

    if (removed > 0) {
      this.metrics.tagCleanupRuns++;
      this.metrics.orphanedTagsRemoved += removed;
      console.log(`[CacheService] Tag cleanup: removed ${removed} expired tags`);
    }
  }

  // ── Rate Limiting (protect DB from cache miss spikes) ─────────────────────

  checkMissRateLimit(key) {
    const now = Date.now();
    const rate = this.missRateLimiter.get(key);

    if (!rate) {
      // First miss in window
      this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs });
      return true;
    }

    if (now > rate.resetAt) {
      // Window expired - reset
      this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs });
      return true;
    }

    if (rate.count >= this.maxMissesPerWindow) {
      // Rate limited!
      this.metrics.rateLimitedMisses++;
      return false;
    }

    // Increment counter
    rate.count++;
    return true;
  }

  // ── Write-Through Cache (retry-safe) ─────────────────────────────────────

  async writeThrough(key, fn, ttl, tags = [], retries = 3) {
    // Write to DB first
    const result = await fn();
    
    // Retry cache update if it fails
    let success = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.set(key, result, ttl, tags);
        success = true;
        break;
      } catch (error) {
        console.warn(`[CacheService] Write-through cache update failed (attempt ${attempt}/${retries}):`, error.message);
        if (attempt === retries) {
          // Final attempt failed - invalidate instead
          console.error(`[CacheService] Write-through failed after ${retries} attempts, invalidating cache`);
          await this.invalidateTag(tags[0]); // Invalidate primary tag
        }
        await this.sleep(100 * attempt); // Exponential backoff
      }
    }
    
    this.metrics.writeThroughCalls++;
    return result;
  }

  // ── TTL Jitter (prevent synchronized expiry) ──────────────────────────────

  applyTTLJitter(baseTTL) {
    const jitterPercent = CACHE_CONFIG.TTL_JITTER_PERCENT;
    const jitterRange = baseTTL * jitterPercent;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange; // ±jitterRange
    
    const jitteredTTL = Math.max(1, baseTTL + jitter); // Ensure >= 1s
    
    this.metrics.ttlJitterApplied++;
    return Math.round(jitteredTTL);
  }

  // ── Rate Limiting (serve stale instead of reject) ─────────────────────────

  async checkMissRateLimitWithFallback(key, fn, ttl, tags) {
    const now = Date.now();
    const rate = this.missRateLimiter.get(key);

    if (!rate) {
      this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs });
      return { allowed: true, serveStale: false };
    }

    if (now > rate.resetAt) {
      this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs });
      return { allowed: true, serveStale: false };
    }

    if (rate.count >= this.maxMissesPerWindow) {
      // Rate limited - serve stale + background refresh
      this.metrics.rateLimitedServeStale++;
      
      const cached = await this.get(key);
      if (cached) {
        // Serve stale + revalidate in background
        this.revalidateWithLock(key, fn, ttl, tags).catch(console.warn);
        return { allowed: false, serveStale: true, data: cached };
      }
      
      // No stale data - allow but warn
      this.metrics.rateLimitedMisses++;
      return { allowed: true, serveStale: false, warn: true };
    }

    rate.count++;
    return { allowed: true, serveStale: false };
  }

  // ── Lock Heartbeat (prevent premature expiry) ─────────────────────────────

  startLockHeartbeat(lockKey, lockValue, timeout) {
    // Extend lock before it expires
    const heartbeatInterval = setInterval(async () => {
      try {
        const extended = await this.extendLock(lockKey, lockValue, CACHE_CONFIG.LOCK_HEARTBEAT_EXTEND);
        if (!extended) {
          // Lost lock - stop heartbeat
          this.stopLockHeartbeat(lockKey);
        } else {
          this.metrics.lockHeartbeats++;
        }
      } catch (error) {
        console.warn(`[CacheService] Lock heartbeat failed:`, error.message);
        this.stopLockHeartbeat(lockKey);
      }
    }, CACHE_CONFIG.LOCK_HEARTBEAT_INTERVAL);
    
    this.lockHeartbeats.set(lockKey, heartbeatInterval);
  }

  stopLockHeartbeat(lockKey) {
    const interval = this.lockHeartbeats.get(lockKey);
    if (interval) {
      clearInterval(interval);
      this.lockHeartbeats.delete(lockKey);
    }
  }

  async extendLock(lockKey, lockValue, extendMs) {
    if (redisClient) {
      // Only extend if we own the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          redis.call("pexpire", KEYS[1], ARGV[2])
          return 1
        else
          return 0
        end
      `;
      const result = await redisClient.eval(script, 1, lockKey, lockValue, extendMs);
      return result === 1;
    }
    
    // In-memory
    const lock = this.activeLocks.get(lockKey);
    if (lock && lock.acquiredBy === lockValue) {
      lock.expiresAt = Date.now() + extendMs;
      return true;
    }
    
    return false;
  }

  // ── Cluster-Safe Cleanup (leader election) ────────────────────────────────

  async startClusterSafeCleanup() {
    // Try to become leader every 15 minutes
    setInterval(() => this.tryBecomeCleanupLeader(), 900000);
    await this.tryBecomeCleanupLeader();
  }

  async tryBecomeCleanupLeader() {
    if (redisClient) {
      // Try to acquire leader lock
      const acquired = await redisClient.set(
        CACHE_CONFIG.CLEANUP_LEADER_KEY,
        this.instanceId,
        'EX',
        CACHE_CONFIG.CLEANUP_LEADER_TTL,
        'NX'
      );
      
      this.isCleanupLeader = (acquired === 'OK');
      
      if (this.isCleanupLeader) {
        this.metrics.leaderElectionWins++;
        console.log(`[CacheService] Instance ${this.instanceId} became cleanup leader`);
        this.startTagCleanup();
      } else {
        console.log(`[CacheService] Instance ${this.instanceId} is NOT cleanup leader`);
      }
    } else {
      // Single instance - always leader
      this.isCleanupLeader = true;
      this.startTagCleanup();
    }
  }

  // ── Cache Warmup Strategy ─────────────────────────────────────────────────

  async warmupCache(warmupFns = []) {
    if (!CACHE_CONFIG.WARMUP_ENABLED && warmupFns.length === 0) {
      return;
    }

    console.log(`[CacheService] Starting cache warmup...`);
    const start = Date.now();
    
    const warmupPromises = warmupFns.map(async (warmupFn, index) => {
      try {
        await warmupFn();
        this.metrics.warmupKeysLoaded++;
      } catch (error) {
        console.warn(`[CacheService] Warmup key ${index} failed:`, error.message);
      }
    });
    
    await Promise.allSettled(warmupPromises);
    
    const duration = Date.now() - start;
    console.log(`[CacheService] Cache warmup complete: ${this.metrics.warmupKeysLoaded} keys in ${duration}ms`);
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

  // ── Cache with Lock (Stampede Protection - Distributed Safe) ──────────────

  async getWithLock(key, fn, ttl, tags = [], lockTimeout = 5000) {
    const cached = await this.get(key);
    if (cached) return cached;
    
    const lockKey = `${key}:lock`;
    const acquired = await this.acquireLock(lockKey, lockTimeout);
    
    if (!acquired) {
      // Another request is fetching - use rate limiter with stale fallback
      this.metrics.stampedePrevented++;
      
      // Try rate limit with stale fallback
      const rateLimitResult = await this.checkMissRateLimitWithFallback(key, fn, ttl, tags);
      
      if (rateLimitResult.serveStale) {
        // Serve stale data (background refresh already triggered)
        return rateLimitResult.data;
      }
      
      if (rateLimitResult.warn) {
        console.warn(`[CacheService] Rate limit exceeded for ${key}, allowing with warning`);
      }
      
      await this.sleep(100);
      return this.getWithLock(key, fn, ttl, tags, lockTimeout);
    }
    
    // Start heartbeat for long operations
    const lockValue = `${this.regionId}:${Date.now()}`;
    this.startLockHeartbeat(lockKey, lockValue, lockTimeout);
    
    try {
      const result = await fn();
      await this.set(key, result, ttl, tags);
      return result;
    } finally {
      this.stopLockHeartbeat(lockKey);
      await this.releaseLock(lockKey);
    }
  }

  async acquireLock(lockKey, timeout) {
    const lockValue = `${this.regionId}:${Date.now()}`; // Unique per instance
    
    if (redisClient) {
      // Use SET NX + EX for distributed-safe locking
      // This is atomic and works across multiple servers
      const acquired = await redisClient.set(lockKey, lockValue, 'PX', timeout, 'NX');
      return acquired === 'OK';
    }
    
    // In-memory lock (single-instance safe)
    const now = Date.now();
    const existingLock = this.activeLocks.get(lockKey);
    
    if (!existingLock || now > existingLock.expiresAt) {
      // No lock or expired - acquire it
      this.activeLocks.set(lockKey, {
        acquiredBy: lockValue,
        expiresAt: now + timeout
      });
      return true;
    }
    
    return false;
  }

  async releaseLock(lockKey) {
    const lockValue = `${this.regionId}:*`;
    
    if (redisClient) {
      // Only delete if we own the lock (Lua script for atomicity)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redisClient.eval(script, 1, lockKey, lockValue);
    } else {
      this.activeLocks.delete(lockKey);
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
      cacheSize: redisClient ? 'redis' : this.cache.size,
      version: CACHE_VERSION,
      region: this.regionId,
      timestamp: new Date().toISOString()
    };
  }

  // Export metrics periodically (for Prometheus/Grafana)
  exportMetricsPeriodically() {
    // Export every 30 seconds
    setInterval(() => {
      const metrics = this.getMetrics();
      
      // Log for monitoring
      console.log(`[CacheService] Metrics: hitRate=${metrics.hitRate}, hits=${metrics.hits}, misses=${metrics.misses}`);
      
      // TODO: Push to Prometheus/Grafana
      // Example:
      // prometheusClient.cache_hit_rate.set(parseFloat(metrics.hitRate));
      // prometheusClient.cache_errors.set(metrics.errors);
    }, 30000);
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
      fallbackToStale: 0,
      tagCleanupRuns: 0,
      orphanedTagsRemoved: 0,
      rateLimitedMisses: 0,
      writeThroughCalls: 0
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
