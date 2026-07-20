import { CACHE_VERSION, CACHE_CONFIG } from './config.js';
import { redisClient } from './redisClient.js';
import { flushResponseCaches } from './flush.js';
import { addKeyToTags, invalidateTags as invalidateRedisTags, MAX_TAGGED_TTL } from './tagIndex.js';

// A cache TTL larger than this almost always means milliseconds were passed to
// a seconds API (the ×1000 bug fixed in Phase 0). Warn loudly.
const SUSPICIOUS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

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

  /**
   * @param {string} key
   * @param {*} value
   * @param {number} ttl  TTL in SECONDS (fed straight to Redis `EX`). Passing
   *   milliseconds is the classic ×1000 bug — a dev-mode guard warns on it.
   * @param {string[]} [tags]  invalidation tags (registered in the Redis tag index)
   */
  async set(key, value, ttl = 300, tags = []) {
    if (ttl > SUSPICIOUS_TTL_SECONDS) {
      console.warn(`[CacheService] Suspicious TTL ${ttl}s for '${key}' — expected seconds, did you pass milliseconds?`);
    } else if (tags.length > 0 && ttl > MAX_TAGGED_TTL) {
      // Beyond this the tag index may expire before the entry, leaving it
      // un-invalidatable until its own TTL. Cap noisy rather than silently wrong.
      console.warn(`[CacheService] Tagged TTL ${ttl}s for '${key}' exceeds tag-index lifetime (${MAX_TAGGED_TTL}s); invalidation past that window is not guaranteed.`);
    }
    try {
      if (redisClient) {
        await redisClient.set(key, JSON.stringify(value), 'EX', ttl);
        if (tags.length > 0) await addKeyToTags(key, tags);
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

  /**
   * Invalidate every cache key filed under any of the given tags. This is the
   * one public invalidation API for the unified cache layer (httpCache +
   * cacheProfiles). Uses the Redis tag index in prod; falls back to the
   * in-memory tagMap when REDIS_URL is unset (dev/tests).
   * @param {...string} tags
   * @returns {Promise<number>} count of cache keys removed
   */
  async invalidateTags(...tags) {
    if (!tags.length) return 0;
    this.metrics.tagInvalidations++;
    if (redisClient) {
      return invalidateRedisTags(...tags);
    }
    let removed = 0;
    for (const tag of tags) {
      const keys = this.tagMap.get(tag);
      if (!keys) continue;
      const snapshot = Array.from(keys);
      await Promise.all(snapshot.map(key => this.delete(key)));
      removed += snapshot.length;
    }
    return removed;
  }

  async invalidatePattern(pattern) {
    console.log(`[CacheService] Invalidating pattern: ${pattern}`);
    this.metrics.patternInvalidations++;
    if (redisClient) {
      // Redis SCAN MATCH is glob, not substring: a bare word like "products"
      // matches ONLY the literal key "products", never "v2:products:facets:…".
      // Callers pass substrings (see invalidateCache docs), so wrap the pattern
      // in wildcards unless it already carries its own glob.
      const glob = pattern.includes('*') ? pattern : `*${pattern}*`;
      let cursor = '0';
      const keys = [];
      do {
        const result = await redisClient.scan(cursor, 'MATCH', glob, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');
      if (keys.length > 0) await redisClient.del(keys);
      return keys.length;
    }
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (this.matchesPattern(key, pattern)) { await this.delete(key); removed++; }
    }
    return removed;
  }

  // Substring/glob match (NOT anchored) — the documented contract of
  // invalidateCache is "keys that CONTAIN the pattern". `*` is honoured as a
  // wildcard so callers can still pass explicit globs.
  matchesPattern(key, pattern) {
    return new RegExp(pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).test(key);
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
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.set(key, result, ttl, tags);
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

  async getStaleWhileRevalidateWithLock(key, fn, ttl, tags = [], _staleWindow = 60) {
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

  startLockHeartbeat(lockKey, lockValue, _timeout) {
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

  // Alias used by routes/redisMonitor.js (/admin/redis/stats and /metrics),
  // which historically called a getStats() that never existed — the admin
  // dashboard's cache section rendered empty.
  getStats() {
    return this.getMetrics();
  }

  /**
   * Clear every response-cache namespace (route:*, public:*, v2:*,
   * delivery-zones:*). Sessions and rate limits are untouched. Backs the
   * admin POST /admin/redis/cache/clear endpoint, which returned 501 before
   * this existed. Same SCAN+UNLINK core as scripts/flush-public-cache.js.
   * @returns {Promise<{total: number, perPattern?: Record<string, number>}>}
   */
  async clear() {
    if (redisClient) {
      const result = await flushResponseCaches(redisClient);
      this.metrics.deletes += result.total;
      return result;
    }
    const total = this.cache.size;
    this.cache.clear();
    this.tagMap.clear();
    this.keyTags.clear();
    this.tagExpiry.clear();
    this.metrics.deletes += total;
    return { total };
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
