/**
 * Cache-Control Headers Middleware
 *
 * Adds appropriate HTTP caching headers to responses based on route type.
 *
 * Usage:
 * - Product listings: cacheMiddleware('product-listing')
 * - Categories/Brands: cacheMiddleware('static-data')
 * - User-specific data: Do NOT cache
 *
 * CDN contract (Cloudflare in front of api.<domain> — see plan §E):
 * - Only routes returning NON-user-specific data are tagged cacheable here; the s-maxage
 *   makes Cloudflare cache them at the edge.
 * - We intentionally do NOT emit `Vary: Cookie`: it would key the shared cache on the full
 *   Cookie header (analytics cookies fragment it) and collapse hit-rate. Instead, configure
 *   Cloudflare to BYPASS cache when an auth cookie (accessToken/refreshToken) is present.
 * - Responses carrying `Set-Cookie` (e.g. CSRF token minted on a GET) are not cached by a
 *   compliant CDN, so per-user tokens can't leak across users.
 */

export const cacheMiddleware = (cacheType = 'default') => {
  return (req, res, next) => {
    // Never cache in development
    if (process.env.NODE_ENV !== 'production') {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      return next();
    }

    // Cache configuration by type
    const cacheConfig = {
      // Product listings - cache for 5 minutes (balances freshness vs performance)
      'product-listing': {
        'Cache-Control': 'public, max-age=300, s-maxage=600', // 5 min browser, 10 min CDN
        'Vary': 'Accept-Encoding'
      },
      
      // Individual product details - cache for 10 minutes
      'product-detail': {
        'Cache-Control': 'public, max-age=600, s-maxage=1200', // 10 min browser, 20 min CDN
        'Vary': 'Accept-Encoding'
      },
      
      // Categories / brands — rarely change, but admin edits must surface quickly
      // in the storefront.
      //
      // s-maxage is deliberately SHORT. The origin invalidates its Redis route
      // cache on every taxonomy write, but nothing can purge a CDN edge from a
      // Mongo write — so any s-maxage is a window of staleness no code path can
      // close. It used to be 7200 (2h): an admin renaming a category would have
      // watched the storefront ignore them for two hours once api.<domain> went
      // behind Cloudflare. 5 min bounds the damage.
      //
      // stale-while-revalidate buys the edge hit-rate back: past the 5 min the
      // edge serves the stale copy instantly and refreshes in the background, so
      // shoppers never pay origin latency. CDNs that ignore SWR (Cloudflare
      // outside Enterprise) just revalidate at s-maxage — correct, slightly less
      // fast. stale-if-error keeps the taxonomy up if the origin is down.
      'static-data': {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400',
        'Vary': 'Accept-Encoding'
      },
      
      // Vehicle data - cache for 30 minutes
      'vehicle-data': {
        'Cache-Control': 'public, max-age=1800, s-maxage=3600', // 30 min browser, 1 hour CDN
        'Vary': 'Accept-Encoding'
      },
      
      // Search results - cache for 2 minutes (high variability)
      'search-results': {
        'Cache-Control': 'public, max-age=120, s-maxage=300', // 2 min browser, 5 min CDN
        'Vary': 'Accept-Encoding, Accept'
      },
      
      // Default - no caching (safe default)
      'default': {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    };

    const config = cacheConfig[cacheType] || cacheConfig['default'];
    
    // Apply cache headers
    Object.entries(config).forEach(([header, value]) => {
      res.set(header, value);
    });

    next();
  };
};

/**
 * Skip cache middleware for authenticated requests
 * Use this to prevent caching of user-specific data
 */
export const skipCacheForAuth = (req, res, next) => {
  // If user is authenticated, don't cache
  if (req.user && req.user.id) {
    res.set('Cache-Control', 'private, no-store, no-cache');
    res.set('Pragma', 'no-cache');
  }
  next();
};
