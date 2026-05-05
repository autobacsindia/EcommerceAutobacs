import { useEffect, useState } from 'react';

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // milliseconds
}

// Global cache storage
const cacheMap = new Map<string, CacheEntry>();

// In-flight request deduplication: concurrent callers for the same key share one Promise
const inflightRequests = new Map<string, Promise<any>>();

/**
 * Get cached data if available and not expired
 */
export function getCache<T>(key: string): T | null {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    // Cache expired
    cacheMap.delete(key);
    return null;
  }
  
  return entry.data as T;
}

/**
 * Set cached data with TTL
 */
export function setCache<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
  try {
    cacheMap.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  } catch (e) {
    console.warn('Failed to set cache:', e);
  }
}

/**
 * Clear cache for specific key or all cache
 */
export function clearCache(key?: string): void {
  if (key) {
    cacheMap.delete(key);
  } else {
    cacheMap.clear();
  }
}

/**
 * Hook for cache-aware data fetching
 */
export function useCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = 5 * 60 * 1000
): { data: T | null; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = async () => {
    try {
      setLoading(true);
      setError(null);

      // Reuse any in-flight request for the same key to avoid duplicate concurrent fetches
      let promise = inflightRequests.get(key);
      if (!promise) {
        promise = fetchFn();
        inflightRequests.set(key, promise);
        // Clean up the map entry when done; suppress the rejection here so the
        // unhandled-rejection handler never fires — the caller's try/catch handles it.
        promise.finally(() => inflightRequests.delete(key)).catch(() => {});
      }

      const result = await promise;
      setData(result);
      setCache(key, result, ttl);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      console.error(`Cache fetch error for ${key}:`, err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cachedData = getCache<T>(key);
    if (cachedData !== null) {
      setData(cachedData);
      setLoading(false);
      return;
    }

    refetch();
  }, [key]);

  return { data, loading, error, refetch };
}

// Pre-configured cache keys for common endpoints
export const CACHE_KEYS = {
  VEHICLE_MAKES: 'vehicleMakes',
  PRODUCTS_SEARCH: (searchTerm: string) => `products_search_${encodeURIComponent(searchTerm)}`,
  PRODUCTS_FEATURED: (limit: number) => `products_featured_${limit}`,
  PRODUCTS_ALL: 'products_all',
  AUTH_CHECK: 'auth_check',
};

// Export metrics for debugging
export function getCacheMetrics() {
  const hits = Array.from(cacheMap.values()).filter(entry => 
    Date.now() - entry.timestamp < entry.ttl
  ).length;
  
  return {
    total: cacheMap.size,
    hits,
    misses: 0, // We can't track misses without wrapping all fetches
    hitRate: cacheMap.size > 0 ? Math.round((hits / cacheMap.size) * 100) : 0
  };
}

// Initialize with some defaults
if (typeof window !== 'undefined') {
  // Log cache metrics periodically for debugging
  setInterval(() => {
    const metrics = getCacheMetrics();
    console.log('[CacheService] Metrics:', metrics);
  }, 30000); // Every 30 seconds
}