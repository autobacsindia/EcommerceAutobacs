/**
 * Session Store Service - Redis-backed distributed session management
 * 
 * Provides fast, distributed session storage for refresh tokens.
 * Enables session revocation across multiple Railway instances.
 * Falls back gracefully if Redis is unavailable.
 */

import Redis from 'ioredis';

class SessionStore {
  constructor() {
    this.redis = null;
    
    if (process.env.REDIS_URL) {
      try {
        this.redis = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: false,
          lazyConnect: true,
        });
        
        this.redis.on('error', (err) => {
          console.error('[SessionStore] Redis error:', err.message);
        });
        
        this.redis.on('connect', () => {
          console.log('[SessionStore] Connected to Redis successfully');
        });
        
        console.log('[SessionStore] Redis session store initialized');
      } catch (err) {
        console.warn('[SessionStore] Redis init failed:', err.message);
        this.redis = null;
      }
    } else {
      console.log('[SessionStore] REDIS_URL not set – using MongoDB-only sessions');
    }
  }

  /**
   * Store session in Redis
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier (refresh token hash)
   * @param {Object} sessionData - Session metadata (IP, device info)
   * @param {number} ttl - Time to live in seconds (default: 30 days)
   */
  async storeSession(userId, sessionId, sessionData = {}, ttl = 30 * 24 * 60 * 60) {
    if (!this.redis) {
      console.warn('[SessionStore] Redis not available, skipping Redis session storage');
      return;
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      const value = JSON.stringify({
        ...sessionData,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      
      // Store session with TTL
      await this.redis.setex(key, ttl, value);
      
      // Also maintain a set of all sessions for this user (for bulk revocation)
      const userSessionsKey = `user:sessions:${userId}`;
      await this.redis.sadd(userSessionsKey, sessionId);
      await this.redis.expire(userSessionsKey, ttl);
      
      console.log(`[SessionStore] Session stored for user ${userId}`);
    } catch (err) {
      console.error('[SessionStore] Failed to store session:', err.message);
      // Don't throw - fail gracefully to avoid blocking login
    }
  }

  /**
   * Validate session exists and is not expired
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier (hashed refresh token)
   * @returns {Promise<boolean>} - True if session is valid
   */
  async validateSession(userId, sessionId) {
    if (!this.redis) {
      // Fallback: assume valid (current MongoDB-only behavior)
      return true;
    }

    try {
      const key = `session:${userId}:${sessionId}`;
      const exists = await this.redis.exists(key);
      
      if (exists === 1) {
        // Update last accessed time
        await this.redis.hset(key, 'lastAccessedAt', new Date().toISOString());
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('[SessionStore] Failed to validate session:', err.message);
      // Fail open to avoid blocking legitimate users
      return true;
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
          } catch (err) {
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
      const keyspace = await this.redis.info('keyspace');
      
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
      
      // Count session keys
      const sessionKeys = await this.redis.keys('session:*');
      stats.sessionKeys = sessionKeys.length;
      stats.totalKeys = sessionKeys.length;
      
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
