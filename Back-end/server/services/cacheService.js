/**
 * Simple In-Memory Cache Service
 * 
 * Provides caching functionality for WordPress API responses and vehicle data
 * to improve performance and reduce external API calls.
 * 
 * Features:
 * - Time-based expiration (default: 5 minutes)
 * - Automatic cleanup of expired entries
 * - Memory usage monitoring
 * - Cache statistics
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    
    // Default TTL: 5 minutes
    this.defaultTTL = 5 * 60 * 1000;
    
    // Start cleanup interval (every minute)
    this.startCleanup();
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if expired
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
  set(key, value, ttl = this.defaultTTL) {
    const expiresAt = Date.now() + ttl;
    
    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });
    
    this.stats.sets++;
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if deleted, false if not found
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }

  /**
   * Clear cache entries matching a pattern
   * @param {string} pattern - Pattern to match (simple string match)
   */
  clearPattern(pattern) {
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.delete(key));
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
