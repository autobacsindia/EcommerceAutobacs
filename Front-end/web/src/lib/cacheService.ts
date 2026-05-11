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
  try {
    // Try in-memory cache first
    const entry = cacheMap.get(key);
    if (entry) {
      const now = Date.now();
      if (now - entry.timestamp <= entry.ttl) {
        return entry.data as T;
      }
      // Cache expired, delete it
      cacheMap.delete(key);
    }
    
    // Fallback to localStorage for persistence across page reloads
    const cached = localStorage.getItem(`cache_${key}`);
    if (cached) {
      const parsed: CacheEntry = JSON.parse(cached);
      const now = Date.now();
      if (now - parsed.timestamp <= parsed.ttl) {
        // Restore to in-memory cache for faster access
        cacheMap.set(key, parsed);
        return parsed.data as T;
      }
      // Cache expired, delete it
      localStorage.removeItem(`cache_${key}`);
    }
  } catch (e) {
    console.warn('Failed to get cache:', e);
  }
  
  return null;
}

/**
 * Set cached data with TTL
 */
export function setCache<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
  try {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl
    };
    
    // Save to in-memory cache
    cacheMap.set(key, entry);
    
    // Also save to localStorage for persistence across page reloads
    try {
      localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (e) {
      // localStorage might be full, ignore error
      console.warn('Failed to save to localStorage:', e);
    }
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
    } catch (err: any) {
      // Don't refetch on 429 (rate limit) errors - just show cached data or error
      if (err?.status === 429 || err?.message?.includes('Too many requests')) {
        console.warn(`[Cache] Rate limited for ${key}, using cached data if available`);
        setError(new Error('Data temporarily unavailable. Please wait a moment.'));
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
        console.error(`Cache fetch error for ${key}:`, err);
      }
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

    // Only refetch if we don't have cached data
    // Add a small delay to prevent burst requests on page load
    const timer = setTimeout(() => {
      refetch();
    }, 100);

    return () => clearTimeout(timer);
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