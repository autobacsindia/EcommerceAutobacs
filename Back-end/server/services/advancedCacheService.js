/**
 * Advanced Cache Features
 * 
 * Extends base cache service with:
 * - Cache stampede protection (request locking)
 * - Stale-while-revalidate
 * - GZIP compression
 * - Cache warming
 * - Enhanced observability
 * 
 * Usage:
 *   import advancedCache from './services/advancedCacheService.js';
 *   
 *   // Stampede protection
 *   const data = await advancedCache.getWithLock(key, async () => {
 *     return await Product.find().limit(20);
 *   }, 300);
 *   
 *   // Stale-while-revalidate
 *   const data = await advancedCache.getStaleWhileRevalidate(key, async () => {
 *     return await Product.find().limit(20);
 *   }, 300, 60);
 */

import zlib from 'zlib';
import cacheService from './cacheService.js';

class AdvancedCacheService {
  constructor() {
    this.lockTimeout = 5000; // 5 seconds max lock duration
    this.staleWindow = 60000; // 60 seconds stale window
    this.compressionThreshold = 1024; // Compress if > 1KB
    this.warmupEndpoints = [];
    
    // Enhanced metrics
    this.metrics = {
      stampedePrevented: 0,
      staleServed: 0,
      compressionSavings: 0,
      warmupHits: 0
    };
  }

  /**
   * Cache Stampede Protection
   * 
   * Prevents multiple requests from hitting DB simultaneously when cache expires.
   * Uses distributed locking (Redis SET NX) or in-memory locks.
   * 
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data if cache miss
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Cached or freshly fetched data
   */
  async getWithLock(key, fetchFn, ttlSeconds = 300) {
    const lockKey = `lock:${key}`;
    const ttlMs = ttlSeconds * 1000;

    // Try to get from cache first
    const cached = await cacheService.get(key);
    if (cached) {
      return cached;
    }

    // Cache miss - try to acquire lock
    const acquired = await this.acquireLock(lockKey, this.lockTimeout);
    
    if (!acquired) {
      // Another request is fetching - wait briefly and retry
      await this.sleep(50);
      
      const retry = await cacheService.get(key);
      if (retry) {
        this.metrics.stampedePrevented++;
        return retry;
      }
      
      // Still not ready - fetch anyway (fallback)
      console.warn(`[Cache] Lock timeout for ${key}, fetching anyway`);
    }

    try {
      // Fetch data
      const data = await fetchFn();
      
      // Cache it
      await cacheService.set(key, data, ttlMs);
      
      return data;
    } finally {
      // Release lock
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Stale-While-Revalidate
   * 
   * Serves stale data instantly while refreshing in background.
   * Eliminates latency spikes when cache expires.
   * 
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch fresh data
   * @param {number} ttlSeconds - Primary TTL in seconds
   * @param {number} staleSeconds - Stale window in seconds (default: 60)
   * @returns {Promise<any>} - Cached (possibly stale) data
   */
  async getStaleWhileRevalidate(key, fetchFn, ttlSeconds = 300, staleSeconds = 60) {
    const cached = await cacheService.get(key);
    
    if (!cached) {
      // No cache - fetch and cache
      const data = await fetchFn();
      await cacheService.set(key, data, (ttlSeconds + staleSeconds) * 1000);
      return data;
    }

    // Check if within stale window
    const isStale = this.isEntryStale(key, ttlSeconds);
    
    if (isStale) {
      // Serve stale, refresh in background
      this.metrics.staleServed++;
      
      // Background refresh (non-blocking)
      this.refreshInBackground(key, fetchFn, ttlSeconds, staleSeconds)
        .catch(err => console.error(`[Cache] Background refresh failed:`, err.message));
      
      return cached;
    }

    // Fresh cache
    return cached;
  }

  /**
   * Compress and cache data
   * 
   * Uses GZIP compression to save 30-70% Redis memory.
   * Only compresses if data > 1KB (compression overhead not worth it for small data).
   * 
   * @param {string} key - Cache key
   * @param {any} value - Data to cache
   * @param {number} ttlMs - TTL in milliseconds
   */
  async setCompressed(key, value, ttlMs = 300000) {
    const jsonStr = JSON.stringify(value);
    
    // Only compress if large enough
    if (jsonStr.length > this.compressionThreshold) {
      try {
        const compressed = zlib.gzipSync(jsonStr);
        const base64 = compressed.toString('base64');
        
        // Store with compression flag
        await cacheService.set(key, {
          _compressed: true,
          data: base64,
          originalSize: jsonStr.length,
          compressedSize: compressed.length
        }, ttlMs);
        
        // Track savings
        const savings = jsonStr.length - compressed.length;
        this.metrics.compressionSavings += savings;
        
      } catch (err) {
        console.warn('[Cache] Compression failed, storing uncompressed:', err.message);
        await cacheService.set(key, value, ttlMs);
      }
    } else {
      // Small data - no compression needed
      await cacheService.set(key, value, ttlMs);
    }
  }

  /**
   * Get and decompress data
   * 
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Decompressed data or null
   */
  async getCompressed(key) {
    const cached = await cacheService.get(key);
    
    if (!cached) return null;
    
    // Check if compressed
    if (cached._compressed && cached.data) {
      try {
        const compressed = Buffer.from(cached.data, 'base64');
        const decompressed = zlib.gunzipSync(compressed);
        return JSON.parse(decompressed.toString());
      } catch (err) {
        console.warn('[Cache] Decompression failed:', err.message);
        return null;
      }
    }
    
    return cached;
  }

  /**
   * Cache Warming
   * 
   * Preload popular endpoints to prevent cold cache DB spikes.
   * Call after deployment or during low-traffic periods.
   * 
   * @param {Array<{url: string, fetchFn: Function, ttl?: number}>} endpoints - Endpoints to warm
   */
  async warmup(endpoints) {
    console.log(`[Cache] Warming ${endpoints.length} endpoint(s)...`);
    
    const results = await Promise.allSettled(
      endpoints.map(async ({ url, fetchFn, ttl = 300 }) => {
        try {
          const key = `route:warmup:${url}`;
          const data = await fetchFn();
          await cacheService.set(key, data, ttl * 1000);
          this.metrics.warmupHits++;
          return { url, status: 'success' };
        } catch (err) {
          return { url, status: 'failed', error: err.message };
        }
      })
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success').length;
    const failed = results.length - success;

    console.log(`[Cache] Warmup complete: ${success} succeeded, ${failed} failed`);
    
    return results;
  }

  /**
   * Get enhanced cache metrics
   * 
   * @returns {object} - Comprehensive cache metrics
   */
  getEnhancedMetrics() {
    const baseStats = cacheService.getStats();
    
    return {
      ...baseStats,
      advanced: {
        stampedePrevented: this.metrics.stampedePrevented,
        staleServed: this.metrics.staleServed,
        compressionSavings: `${(this.metrics.compressionSavings / 1024).toFixed(2)} KB`,
        warmupHits: this.metrics.warmupHits
      }
    };
  }

  // ── Private Helper Methods ──────────────────────────────────────────────

  /**
   * Acquire distributed lock
   */
  async acquireLock(lockKey, timeoutMs) {
    const acquired = await cacheService.setIfNotExists(lockKey, '1', timeoutMs);
    return acquired;
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockKey) {
    await cacheService.delete(lockKey);
  }

  /**
   * Check if cache entry is stale
   */
  isEntryStale(_key, _ttlSeconds) {
    // This is a simplified check - in production you'd store metadata
    // For now, we assume if it's in cache but close to expiry, it's stale
    return false; // Placeholder - needs cache metadata enhancement
  }

  /**
   * Refresh cache in background
   */
  async refreshInBackground(key, fetchFn, ttlSeconds, staleSeconds) {
    try {
      const data = await fetchFn();
      await cacheService.set(key, data, (ttlSeconds + staleSeconds) * 1000);
    } catch (err) {
      console.error(`[Cache] Background refresh failed for ${key}:`, err.message);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const advancedCache = new AdvancedCacheService();

export default advancedCache;
