import { CACHE_VERSION, CACHE_CONFIG, TTL } from './config.js';
import { redisClient } from './redisClient.js';

class CacheService {
  constructor() {
    this.cache = new Map();
    this.tagMap = new Map();
    this.keyTags = new Map();
    this.tagExpiry = new Map();
    this.activeLocks = new Map();
    this.missRateLimiter = new Map();
    this.maxMissesPerWindow = 10;
    this.missWindowMs = 10000;
    this.regionId = process.env.REGION_ID || 'default';
    this.instanceId = `${this.regionId}:${process.pid}:${Date.now()}`;
    this.isCleanupLeader = false;
    this.lockHeartbeats = new Map();
    this.metrics = {
      hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0,
      tagInvalidations: 0, patternInvalidations: 0, stalenessServed: 0,
      stampedePrevented: 0, fallbackToDB: 0, fallbackToStale: 0,
      tagCleanupRuns: 0, orphanedTagsRemoved: 0, rateLimitedMisses: 0,
      writeThroughCalls: 0, ttlJitterApplied: 0, lockHeartbeats: 0,
      warmupKeysLoaded: 0, leaderElectionWins: 0, rateLimitedServeStale: 0
    };
    this.defaultTTL = 90 * 1000;
    this.startCleanup();
    this.startClusterSafeCleanup();
    this.exportMetricsPeriodically();
    if (CACHE_CONFIG.WARMUP_ENABLED) {
      this.warmupCache().catch(console.error);
    }
  }

  // ── Core ──────────────────────────────────────────────────────────────────

  generateKey(prefix, params = {}) {
    const versionedPrefix = `${CACHE_VERSION}:${this.regionId}:${prefix}`;
    const parts = [versionedPrefix];
    for (const key of Object.keys(params).sort()) {
      const value = params[key];
      if (value !== undefined && value !== null) parts.push(`${key}=${value}`);
    }
    return parts.join(':');
  }

  async wrap(key, fn, options = {}) {
    const { ttl = 300, strategy = 'basic', tags = [] } = options;
    const jitteredTTL = this.applyTTLJitter(ttl);
    try {
      if (strategy === 'swr') return this.getStaleWhileRevalidateWithLock(key, fn, jitteredTTL, tags);
      if (strategy === 'lock') return this.getWithLock(key, fn, jitteredTTL, tags);
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
        if (value === null || value === undefined) { this.metrics.misses++; return null; }
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
      if (!entry) { this.metrics.misses++; return null; }
      if (Date.now() > entry.expiry) { this.cache.delete(key); this.metrics.misses++; return null; }
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
        this.cache.set(key, { value, expiry: Date.now() + (ttl * 1000) });
      }
      if (tags.length > 0) this.trackTags(key, tags);
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
      this.untrackTags(key);
      this.metrics.deletes++;
    } catch (error) {
      this.metrics.errors++;
      console.warn('[CacheService] DELETE error:', error.message);
    }
  }

  // ── Tag Invalidation ──────────────────────────────────────────────────────

  trackTags(key, tags) {
    const now = Date.now();
    const tagTTL = 7200000;
    for (const tag of tags) {
      if (!this.tagMap.has(tag)) this.tagMap.set(tag, new Set());
      this.tagMap.get(tag).add(key);
      if (!this.keyTags.has(key)) this.keyTags.set(key, new Set());
      this.keyTags.get(key).add(tag);
      this.tagExpiry.set(tag, now + tagTTL);
    }
  }

  untrackTags(key) {
    const tags = this.keyTags.get(key);
    if (tags) {
      for (const tag of tags) this.tagMap.get(tag)?.delete(key);
      this.keyTags.delete(key);
    }
  }

  async invalidateTag(tag) {
    const keys = this.tagMap.get(tag);
    if (!keys || keys.size === 0) return;
    console.log(`[CacheService] Invalidating tag '${tag}': ${keys.size} keys`);
    await Promise.all(Array.from(keys).map(key => this.delete(key)));
    this.metrics.tagInvalidations++;
  }

  async invalidatePattern(pattern) {
    console.log(`[CacheService] Invalidating pattern: ${pattern}`);
    if (redisClient) {
      let cursor = '0';
      const keys = [];
      do {
        const result = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');
      if (keys.length > 0) await redisClient.del(keys);
    } else {
      for (const key of this.cache.keys()) {
        if (this.matchesPattern(key, pattern)) await this.delete(key);
      }
    }
    this.metrics.patternInvalidations++;
  }

  matchesPattern(key, pattern) {
    return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(key);
  }

  // ── Tag Cleanup ───────────────────────────────────────────────────────────

  startTagCleanup() {
    if (!this.isCleanupLeader && redisClient) return;
    setInterval(() => this.cleanupExpiredTags(), 900000);
  }

  cleanupExpiredTags() {
    const now = Date.now();
    let removed = 0;
    for (const [tag, expiry] of this.tagExpiry.entries()) {
      if (now > expiry) {
        this.tagMap.delete(tag);
        this.tagExpiry.delete(tag);
        removed++;
        for (const [key, tags] of this.keyTags.entries()) {
          tags.delete(tag);
          if (tags.size === 0) this.keyTags.delete(key);
        }
      }
    }
    if (removed > 0) {
      this.metrics.tagCleanupRuns++;
      this.metrics.orphanedTagsRemoved += removed;
      console.log(`[CacheService] Tag cleanup: removed ${removed} expired tags`);
    }
  }

  // ── Miss Rate Limiting ────────────────────────────────────────────────────

  checkMissRateLimit(key) {
    const now = Date.now();
    const rate = this.missRateLimiter.get(key);
    if (!rate) { this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs }); return true; }
    if (now > rate.resetAt) { this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs }); return true; }
    if (rate.count >= this.maxMissesPerWindow) { this.metrics.rateLimitedMisses++; return false; }
    rate.count++;
    return true;
  }

  async checkMissRateLimitWithFallback(key, fn, ttl, tags) {
    const now = Date.now();
    const rate = this.missRateLimiter.get(key);
    if (!rate) { this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs }); return { allowed: true, serveStale: false }; }
    if (now > rate.resetAt) { this.missRateLimiter.set(key, { count: 1, resetAt: now + this.missWindowMs }); return { allowed: true, serveStale: false }; }
    if (rate.count >= this.maxMissesPerWindow) {
      this.metrics.rateLimitedServeStale++;
      const cached = await this.get(key);
      if (cached) {
        this.revalidateWithLock(key, fn, ttl, tags).catch(console.warn);
        return { allowed: false, serveStale: true, data: cached };
      }
      this.metrics.rateLimitedMisses++;
      return { allowed: true, serveStale: false, warn: true };
    }
    rate.count++;
    return { allowed: true, serveStale: false };
  }

  // ── Write-Through ─────────────────────────────────────────────────────────

  async writeThrough(key, fn, ttl, tags = [], retries = 3) {
    const result = await fn();
    let success = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.set(key, result, ttl, tags);
        success = true;
        break;
      } catch (error) {
        console.warn(`[CacheService] Write-through cache update failed (attempt ${attempt}/${retries}):`, error.message);
        if (attempt === retries) {
          console.error(`[CacheService] Write-through failed after ${retries} attempts, invalidating cache`);
          await this.invalidateTag(tags[0]);
        }
        await this.sleep(100 * attempt);
      }
    }
    this.metrics.writeThroughCalls++;
    return result;
  }

  // ── TTL Jitter ────────────────────────────────────────────────────────────

  applyTTLJitter(baseTTL) {
    const jitterRange = baseTTL * CACHE_CONFIG.TTL_JITTER_PERCENT;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    this.metrics.ttlJitterApplied++;
    return Math.round(Math.max(1, baseTTL + jitter));
  }

  // ── SWR & Locking ─────────────────────────────────────────────────────────

  async getStaleWhileRevalidateWithLock(key, fn, ttl, tags = [], staleWindow = 60) {
    const cached = await this.get(key);
    if (cached) {
      this.metrics.stalenessServed++;
      this.revalidateWithLock(key, fn, ttl, tags).catch(err => {
        console.warn(`[CacheService] Background revalidation failed:`, err.message);
      });
      return cached;
    }
    return this.getWithLock(key, fn, ttl, tags);
  }

  async revalidateWithLock(key, fn, ttl, tags) {
    const lockKey = `${key}:lock`;
    const lockValue = await this.acquireLock(lockKey, 5000);
    if (!lockValue) return;
    try {
      const result = await fn();
      await this.set(key, result, ttl, tags);
    } finally {
      await this.releaseLock(lockKey, lockValue);
    }
  }

  async getWithLock(key, fn, ttl, tags = [], lockTimeout = 5000) {
    const cached = await this.get(key);
    if (cached) return cached;

    const lockKey = `${key}:lock`;
    const lockValue = await this.acquireLock(lockKey, lockTimeout);

    if (!lockValue) {
      this.metrics.stampedePrevented++;
      const rateLimitResult = await this.checkMissRateLimitWithFallback(key, fn, ttl, tags);
      if (rateLimitResult.serveStale) return rateLimitResult.data;
      if (rateLimitResult.warn) console.warn(`[CacheService] Rate limit exceeded for ${key}, allowing with warning`);
      await this.sleep(100);
      return this.getWithLock(key, fn, ttl, tags, lockTimeout);
    }

    this.startLockHeartbeat(lockKey, lockValue, lockTimeout);
    try {
      const result = await fn();
      await this.set(key, result, ttl, tags);
      return result;
    } finally {
      this.stopLockHeartbeat(lockKey);
      await this.releaseLock(lockKey, lockValue);
    }
  }

  // Returns the lock value string if acquired, null if not.
  async acquireLock(lockKey, timeout) {
    const lockValue = `${this.regionId}:${Date.now()}`;
    if (redisClient) {
      const acquired = await redisClient.set(lockKey, lockValue, 'PX', timeout, 'NX');
      return acquired === 'OK' ? lockValue : null;
    }
    const now = Date.now();
    const existingLock = this.activeLocks.get(lockKey);
    if (!existingLock || now > existingLock.expiresAt) {
      this.activeLocks.set(lockKey, { acquiredBy: lockValue, expiresAt: now + timeout });
      return lockValue;
    }
    return null;
  }

  async releaseLock(lockKey, lockValue) {
    if (redisClient) {
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

  // ── Lock Heartbeat ────────────────────────────────────────────────────────

  startLockHeartbeat(lockKey, lockValue, timeout) {
    const heartbeatInterval = setInterval(async () => {
      try {
        const extended = await this.extendLock(lockKey, lockValue, CACHE_CONFIG.LOCK_HEARTBEAT_EXTEND);
        if (!extended) {
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
    if (interval) { clearInterval(interval); this.lockHeartbeats.delete(lockKey); }
  }

  async extendLock(lockKey, lockValue, extendMs) {
    if (redisClient) {
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
    const lock = this.activeLocks.get(lockKey);
    if (lock && lock.acquiredBy === lockValue) { lock.expiresAt = Date.now() + extendMs; return true; }
    return false;
  }

  // ── Cluster-Safe Cleanup ──────────────────────────────────────────────────

  async startClusterSafeCleanup() {
    setInterval(() => this.tryBecomeCleanupLeader(), 900000);
    await this.tryBecomeCleanupLeader();
  }

  async tryBecomeCleanupLeader() {
    if (redisClient) {
      const acquired = await redisClient.set(
        CACHE_CONFIG.CLEANUP_LEADER_KEY,
        this.instanceId,
        'EX', CACHE_CONFIG.CLEANUP_LEADER_TTL,
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
      this.isCleanupLeader = true;
      this.startTagCleanup();
    }
  }

  // ── Cache Warmup ──────────────────────────────────────────────────────────

  async warmupCache(warmupFns = []) {
    if (!CACHE_CONFIG.WARMUP_ENABLED && warmupFns.length === 0) return;
    console.log(`[CacheService] Starting cache warmup...`);
    const start = Date.now();
    await Promise.allSettled(warmupFns.map(async (warmupFn, index) => {
      try {
        await warmupFn();
        this.metrics.warmupKeysLoaded++;
      } catch (error) {
        console.warn(`[CacheService] Warmup key ${index} failed:`, error.message);
      }
    }));
    console.log(`[CacheService] Cache warmup complete: ${this.metrics.warmupKeysLoaded} keys in ${Date.now() - start}ms`);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

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

  exportMetricsPeriodically() {
    setInterval(() => {
      const metrics = this.getMetrics();
      console.log(`[CacheService] Metrics: hitRate=${metrics.hitRate}, hits=${metrics.hits}, misses=${metrics.misses}`);
    }, 30000);
  }

  resetMetrics() {
    this.metrics = {
      hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0,
      tagInvalidations: 0, patternInvalidations: 0, stalenessServed: 0,
      stampedePrevented: 0, fallbackToDB: 0, fallbackToStale: 0,
      tagCleanupRuns: 0, orphanedTagsRemoved: 0, rateLimitedMisses: 0,
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
        if (now > entry.expiry) this.cache.delete(key);
      }
    }, 60000);
  }
}

export default CacheService;
