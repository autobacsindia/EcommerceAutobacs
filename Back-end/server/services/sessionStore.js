/**
 * Session Store Service - Redis-backed distributed session management
 * 
 * Provides fast, distributed session storage for refresh tokens.
 * Enables session revocation across multiple Railway instances.
 * Falls back gracefully if Redis is unavailable.
 */

import { getRedisClient } from './redisClient.js';

/**
 * Circuit Breaker States
 */
const CircuitState = {
  CLOSED: 'CLOSED',      // Normal operation
  OPEN: 'OPEN',          // Failing, reject requests
  HALF_OPEN: 'HALF_OPEN' // Testing if recovered
};

class SessionStore {
  constructor() {
    this.redis = null;
    
    // Circuit breaker state
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    
    // Circuit breaker configuration
    this.FAILURE_THRESHOLD = 5; // Open circuit after 5 failures
    this.RECOVERY_TIMEOUT = 30000; // 30s before trying again (HALF_OPEN)
    this.SUCCESS_THRESHOLD = 3; // Close circuit after 3 successes in HALF_OPEN
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      circuitOpens: 0,
      averageLatency: 0,
      latencySamples: [],
      cacheHits: 0,
      cacheMisses: 0,
      rehydrations: 0,
      stampedePrevented: 0,
    };
    
    this.redis = getRedisClient();
    if (this.redis) {
      this.redis.on('error', () => this.recordFailure());
      this.redis.on('connect', () => this.recordSuccess());
      this.redis.on('close', () => this.recordFailure());
    }
  }

  /**
   * Record successful operation for circuit breaker
   */
  recordSuccess() {
    this.successCount++;
    this.metrics.successfulRequests++;
    
    if (this.circuitState === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.SUCCESS_THRESHOLD) {
        // Recovery confirmed - close circuit
        this.circuitState = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        console.log('[CircuitBreaker] Circuit CLOSED - Redis recovered');
      }
    } else {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record failed operation for circuit breaker
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.metrics.failedRequests++;
    
    if (this.circuitState === CircuitState.CLOSED) {
      if (this.failureCount >= this.FAILURE_THRESHOLD) {
        // Too many failures - open circuit
        this.circuitState = CircuitState.OPEN;
        this.metrics.circuitOpens++;
        console.error(`[CircuitBreaker] Circuit OPENED after ${this.failureCount} failures`);
      }
    }
  }

  /**
   * Check if circuit breaker allows request
   * @returns {boolean} - True if request allowed
   */
  isCircuitClosed() {
    if (this.circuitState === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.circuitState === CircuitState.OPEN) {
      // Check if recovery timeout has elapsed
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.RECOVERY_TIMEOUT) {
        // Transition to HALF_OPEN - allow one test request
        this.circuitState = CircuitState.HALF_OPEN;
        this.successCount = 0;
        console.log('[CircuitBreaker] Circuit HALF_OPEN - testing recovery');
        return true;
      }
      return false; // Still in OPEN state, reject request
    }
    
    // HALF_OPEN - allow test requests
    return true;
  }

  /**
   * Track request latency for metrics
   * @param {number} latencyMs - Request latency in milliseconds
   */
  trackLatency(latencyMs) {
    this.metrics.latencySamples.push(latencyMs);
    
    // Keep only last 100 samples
    if (this.metrics.latencySamples.length > 100) {
      this.metrics.latencySamples.shift();
    }
    
    // Calculate rolling average
    const sum = this.metrics.latencySamples.reduce((a, b) => a + b, 0);
    this.metrics.averageLatency = Math.round(sum / this.metrics.latencySamples.length);
  }

  /**
   * Get comprehensive metrics
   * @returns {Object} - Metrics data
   */
  getMetrics() {
    const total = this.metrics.totalRequests;
    const successRate = total > 0 ? ((this.metrics.successfulRequests / total) * 100).toFixed(2) : 0;
    
    return {
      ...this.metrics,
      totalRequests: total,
      successRate: `${successRate}%`,
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      uptime: this.redis ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Store session in Redis with sliding expiration
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier (refresh token hash)
   * @param {Object} sessionData - Session metadata (IP, device info)
   * @param {number} ttl - Time to live in seconds (default: 30 days)
   */
  async storeSession(userId, sessionId, sessionData = {}, ttl = 30 * 24 * 60 * 60) {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    
    // Check circuit breaker
    if (!this.isCircuitClosed()) {
      console.warn('[SessionStore] Circuit OPEN - rejecting storeSession request');
      throw new Error('Redis circuit breaker is OPEN - service temporarily unavailable');
    }
    
    if (!this.redis) {
      // In production, refuse to operate without Redis (prevents split-brain)
      if (process.env.NODE_ENV === 'production') {
        console.error('[SessionStore] CRITICAL: Redis unavailable in production - refusing to store session');
        throw new Error('Redis unavailable - cannot maintain consistent session state');
      }
      
      // In development, log warning but continue (graceful degradation for local testing)
      console.warn('[SessionStore] Redis not available, skipping Redis session storage (dev mode)');
      return;
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      const value = JSON.stringify({
        ...sessionData,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      
      // Store session with EXPLICIT TTL (prevents memory leak)
      await this.redis.setex(key, ttl, value);
      
      // Also maintain a set of all sessions for this user (for bulk revocation)
      const userSessionsKey = `user:sessions:${userId}`;
      await this.redis.sadd(userSessionsKey, sessionId);
      await this.redis.expire(userSessionsKey, ttl);
      
      // Record success and latency
      this.recordSuccess();
      this.trackLatency(Date.now() - startTime);
      
      console.log(`[SessionStore] Session stored for user ${userId} (TTL: ${ttl}s)`);
    } catch (err) {
      console.error('[SessionStore] Failed to store session:', err.message);
      this.recordFailure();
      
      // In production, re-throw to prevent inconsistent state
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Failed to store session in Redis: ${err.message}`);
      }
      // In dev, fail silently to avoid blocking local development
    }
  }

  /**
   * Refresh session TTL (sliding expiration)
   * Called on each valid request to keep active sessions alive
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier
   * @param {number} ttl - New TTL in seconds
   */
  async refreshSessionTTL(userId, sessionId, ttl = 30 * 24 * 60 * 60) {
    if (!this.redis) {
      return; // Silent fail - don't block requests
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      const exists = await this.redis.exists(key);
      
      if (exists === 1) {
        // Extend TTL (sliding expiration)
        await this.redis.expire(key, ttl);
        
        // Also refresh the user's session set
        const userSessionsKey = `user:sessions:${userId}`;
        await this.redis.expire(userSessionsKey, ttl);
      }
    } catch (err) {
      // Don't throw - TTL refresh is best-effort
      console.warn('[SessionStore] Failed to refresh TTL:', err.message);
    }
  }

  /**
   * Validate session exists and is not expired
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier (hashed refresh token)
   * @returns {Promise<boolean>} - True if session is valid
   */
  async validateSession(userId, sessionId) {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    
    // Check circuit breaker
    if (!this.isCircuitClosed()) {
      console.warn('[SessionStore] Circuit OPEN - rejecting validateSession request');
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis circuit breaker is OPEN - service temporarily unavailable');
      }
      return true; // Dev mode: allow through
    }
    
    if (!this.redis) {
      // In production, refuse to validate without Redis (prevents split-brain auth)
      if (process.env.NODE_ENV === 'production') {
        console.error('[SessionStore] CRITICAL: Redis unavailable in production - cannot validate session');
        throw new Error('Redis unavailable - cannot validate session consistently');
      }
      
      // In development, assume valid (graceful degradation for local testing)
      console.warn('[SessionStore] Redis not available, assuming session valid (dev mode)');
      return true;
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      const exists = await this.redis.exists(key);
      
      if (exists === 1) {
        // Update last accessed time (extend TTL on access)
        await this.redis.hset(key, 'lastAccessedAt', new Date().toISOString());
        
        // Record cache hit
        this.metrics.cacheHits++;
        this.recordSuccess();
        this.trackLatency(Date.now() - startTime);
        
        return true;
      }
      
      // Record cache miss
      this.metrics.cacheMisses++;
      this.recordSuccess();
      this.trackLatency(Date.now() - startTime);
      
      return false;
    } catch (err) {
      console.error('[SessionStore] Failed to validate session:', err.message);
      this.recordFailure();
      
      // In production, fail closed (deny access) rather than fail open
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Failed to validate session in Redis: ${err.message}`);
      }
      
      // In dev, fail open to avoid blocking development
      return true;
    }
  }

  /**
   * Acquire distributed lock for cache rehydration (prevents stampede)
   * Uses token-based locking for safety
   * @param {string} lockKey - Lock key (e.g., 'lock:session:USER_ID:SESSION_ID')
   * @param {number} ttl - Lock TTL in seconds (default: 5s)
   * @returns {Promise<string|null>} - Lock token if acquired, null otherwise
   */
  async acquireLock(lockKey, ttl = 5) {
    const startTime = Date.now();
    this.metrics.totalRequests++;
    
    // Check circuit breaker
    if (!this.isCircuitClosed()) {
      console.warn('[SessionStore] Circuit OPEN - rejecting lock acquisition');
      return null;
    }
    
    if (!this.redis) {
      return null;
    }

    try {
      // Generate unique token for this lock
      const crypto = await import('crypto');
      const token = crypto.randomBytes(16).toString('hex');
      
      // SET NX EX = Set if Not eXists with EXpiry (atomic)
      const result = await this.redis.set(lockKey, token, 'NX', 'EX', ttl);
      
      if (result === 'OK') {
        // Lock acquired - return token
        this.recordSuccess();
        this.trackLatency(Date.now() - startTime);
        this.metrics.stampedePrevented++;
        return token;
      }
      
      // Lock not acquired
      this.recordSuccess();
      this.trackLatency(Date.now() - startTime);
      return null;
    } catch (err) {
      console.error('[SessionStore] Failed to acquire lock:', err.message);
      this.recordFailure();
      return null;
    }
  }

  /**
   * Release distributed lock (token-based for safety)
   * @param {string} lockKey - Lock key
   * @param {string} token - Lock token (must match)
   */
  async releaseLock(lockKey, token) {
    if (!this.redis || !token) {
      return;
    }

    try {
      // Use Lua script for atomic check-and-delete (prevents deleting someone else's lock)
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      await this.redis.eval(luaScript, 1, lockKey, token);
    } catch (err) {
      console.warn('[SessionStore] Failed to release lock:', err.message);
      // Don't throw - lock will expire automatically
    }
  }

  /**
   * Revoke a single session (logout from one device)
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier (hashed refresh token)
   */
  async revokeSession(userId, sessionId) {
    if (!this.redis) {
      console.warn('[SessionStore] Redis not available, cannot revoke session from Redis');
      return;
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      await this.redis.del(key);
      
      // Remove from user's session set
      const userSessionsKey = `user:sessions:${userId}`;
      await this.redis.srem(userSessionsKey, sessionId);
      
      console.log(`[SessionStore] Session revoked for user ${userId}`);
    } catch (err) {
      console.error('[SessionStore] Failed to revoke session:', err.message);
    }
  }

  /**
   * Revoke ALL sessions for a user (logout everywhere)
   * @param {string} userId - User ID
   */
  async revokeAllSessions(userId) {
    if (!this.redis) {
      console.warn('[SessionStore] Redis not available, cannot revoke all sessions');
      return;
    }

    try {
      // Get all session IDs for this user
      const userSessionsKey = `user:sessions:${userId}`;
      const sessionIds = await this.redis.smembers(userSessionsKey);
      
      // Delete each session
      if (sessionIds.length > 0) {
        const keys = sessionIds.map(sid => `session:${userId}:${sid}`);
        await this.redis.del(...keys);
        console.log(`[SessionStore] Revoked ${sessionIds.length} sessions for user ${userId}`);
      }
      
      // Delete the set
      await this.redis.del(userSessionsKey);
    } catch (err) {
      console.error('[SessionStore] Failed to revoke all sessions:', err.message);
    }
  }

  /**
   * Refresh-token rotation grace window.
   *
   * When a refresh token A is rotated to B, we cache B (the successor token
   * pair) under A's hash for a short window. This makes /auth/refresh
   * IDEMPOTENT under concurrency: a lagging or concurrent request that still
   * carries the just-rotated token A gets the same successor B back, instead of
   * a 401 or the "reuse detected" session wipe. Replays AFTER the window elapses
   * are still treated as genuine token theft.
   *
   * Keyed purely by the token hash (globally unique 64-byte random), so it can
   * be looked up even after A has been removed from the user's active token set.
   *
   * @param {string} oldTokenHash - sha256 hash of the rotated (old) refresh token
   * @param {Object} successor - { accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry }
   * @param {number} ttl - grace window in seconds
   */
  async storeRotationGrace(oldTokenHash, successor, ttl) {
    if (!this.redis || ttl <= 0) return; // best-effort; dev-without-Redis falls back to prior behavior
    try {
      const key = `rotation:grace:${oldTokenHash}`;
      await this.redis.setex(key, ttl, JSON.stringify(successor));
    } catch (err) {
      // Non-fatal: without the grace entry a racing request may 401, but the
      // primary rotation already succeeded — never block the happy path on this.
      console.warn('[SessionStore] Failed to store rotation grace:', err.message);
    }
  }

  /**
   * Look up the successor token pair for a just-rotated refresh token.
   * @param {string} oldTokenHash - sha256 hash of the presented (old) refresh token
   * @returns {Promise<Object|null>} - cached successor pair, or null if outside the window
   */
  async getRotationGrace(oldTokenHash) {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`rotation:grace:${oldTokenHash}`);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[SessionStore] Failed to read rotation grace:', err.message);
      return null;
    }
  }

  /**
   * Get active session count for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} - Number of active sessions
   */
  async getSessionCount(userId) {
    if (!this.redis) {
      return 0;
    }

    try {
      const userSessionsKey = `user:sessions:${userId}`;
      const count = await this.redis.scard(userSessionsKey);
      return count;
    } catch (err) {
      console.error('[SessionStore] Failed to get session count:', err.message);
      return 0;
    }
  }

  /**
   * Get all active sessions for a user (for admin dashboard)
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - Array of session metadata
   */
  async getUserSessions(userId) {
    if (!this.redis) {
      return [];
    }

    try {
      const userSessionsKey = `user:sessions:${userId}`;
      const sessionIds = await this.redis.smembers(userSessionsKey);
      
      const sessions = [];
      for (const sessionId of sessionIds) {
        const key = `session:${userId}:${sessionId}`;
        const data = await this.redis.get(key);
        
        if (data) {
          try {
            const parsed = JSON.parse(data);
            sessions.push({
              sessionId,
              ...parsed,
            });
          } catch {
            // Skip corrupted entries
            console.warn(`[SessionStore] Corrupted session data for ${sessionId}`);
          }
        }
      }
      
      return sessions;
    } catch (err) {
      console.error('[SessionStore] Failed to get user sessions:', err.message);
      return [];
    }
  }

  /**
   * Check if Redis is connected and healthy
   * @returns {Promise<boolean>} - True if Redis is healthy
   */
  async isHealthy() {
    if (!this.redis) {
      return false;
    }

    try {
      const ping = await this.redis.ping();
      return ping === 'PONG';
    } catch (err) {
      console.error('[SessionStore] Health check failed:', err.message);
      return false;
    }
  }

  /**
   * Get Redis statistics
   * @returns {Promise<Object>} - Redis stats
   */
  async getStats() {
    if (!this.redis) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info();

      // Parse basic stats
      const stats = {
        connected: true,
        uptime: null,
        usedMemory: null,
        connectedClients: null,
        totalKeys: 0,
        sessionKeys: 0,
      };
      
      // Parse info lines
      info.split('\n').forEach(line => {
        if (line.startsWith('uptime_in_seconds:')) {
          stats.uptime = parseInt(line.split(':')[1]);
        } else if (line.startsWith('used_memory_human:')) {
          stats.usedMemory = line.split(':')[1].trim();
        } else if (line.startsWith('connected_clients:')) {
          stats.connectedClients = parseInt(line.split(':')[1]);
        }
      });
      
      // Count session keys with non-blocking SCAN — KEYS blocks the shared
      // cache/session instance and is O(keyspace) per admin stats call.
      // Iterations are capped so a huge keyspace can't hammer Upstash. Keys are
      // deduped via a Set: SCAN may return the same key across iterations
      // (especially during rehashing), so summing lengths would over-count.
      const sessionKeys = new Set();
      let cursor = '0';
      let iterations = 0;
      const MAX_SCAN_ITERATIONS = 100; // 100 × COUNT 500 = up to 50k keys examined
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 500);
        cursor = nextCursor;
        for (const k of keys) sessionKeys.add(k);
        iterations++;
      } while (cursor !== '0' && iterations < MAX_SCAN_ITERATIONS);
      if (cursor !== '0') {
        stats.sessionKeysTruncated = true;
      }
      stats.sessionKeys = sessionKeys.size;
      stats.totalKeys = sessionKeys.size;
      
      return stats;
    } catch (err) {
      console.error('[SessionStore] Failed to get stats:', err.message);
      return { connected: false, error: err.message };
    }
  }

  /**
   * Clean up expired sessions (Redis handles this automatically via TTL)
   * This method is for monitoring/logging purposes only
   */
  async cleanupExpiredSessions() {
    if (!this.redis) {
      return;
    }

    try {
      // Redis automatically expires keys with TTL
      // No manual cleanup needed
      console.log('[SessionStore] Redis handles expiration automatically via TTL');
    } catch (err) {
      console.error('[SessionStore] Cleanup error:', err.message);
    }
  }
}

// Export singleton instance
export default new SessionStore();
