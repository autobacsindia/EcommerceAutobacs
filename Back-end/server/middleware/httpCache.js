/**
 * Unified response-cache middleware.
 *
 * Supersedes the forked pair (cacheMiddleware `cacheResponse` + publicCache
 * `publicCacheResponse`) and folds in the HTTP Cache-Control layer that used to
 * live separately in cacheControl.js. One call — httpCache('PROFILE_NAME') —
 * now drives Redis TTL, invalidation tags, and the CDN/browser header from a
 * single row in config/cacheProfiles.js.
 *
 * Safety model:
 *   - GET only; never caches authenticated requests, /admin, or sensitive paths.
 *   - Authenticated / non-2xx / Set-Cookie responses emit `private, no-store`
 *     and are never stored (so per-user data can't leak via the shared cache).
 *   - CACHE_DISABLED=1 turns the whole layer into a pass-through (the Phase-1
 *     rollback lever — flip it on Railway, no redeploy).
 *   - Redis errors bypass to origin; a cache failure never breaks a request.
 *   - 'lock'-strategy profiles (the product list) don't store here — the
 *     controller owns caching via CacheService.getWithLock — but still get their
 *     Cache-Control header set.
 */

import crypto from 'crypto';
import cacheService from '../services/cacheService.js';
import { CACHE_VERSION } from '../services/cache/config.js';
import { routeNamespace } from '../utils/cacheKeys.js';
import {
  CACHE_PROFILES,
  HTTP_CACHE_HEADERS,
  PRIVATE_NO_STORE,
  resolveTags,
} from '../config/cacheProfiles.js';

const SKIP_PATHS = ['/auth', '/checkout', '/payment', '/user', '/profile'];

export const isCacheDisabled = () => process.env.CACHE_DISABLED === '1' || process.env.CACHE_DISABLED === 'true';

/** True when the request carries any sign of an authenticated user. */
const isAuthenticated = (req) =>
  Boolean(req.headers.authorization || req.user || req.cookies?.accessToken || req.cookies?.refreshToken);

/**
 * Deterministic cache key: `v3:resp:<namespace>:<md5(url+query+locale[+region])>`.
 * Shared with productController so the list route's controller-side getWithLock
 * and any middleware agree on the key. `regional` folds in the region id so
 * price/currency variants don't collide.
 */
export const buildResponseKey = (req, { regional = false } = {}) => {
  const base = {
    url: req.originalUrl,
    query: req.query,
    locale: req.headers['accept-language']?.split(',')[0] || 'default',
    region: regional ? (cacheService.regionId || 'default') : undefined,
  };
  const hash = crypto.createHash('md5').update(JSON.stringify(base)).digest('hex');
  return `${CACHE_VERSION}:resp:${routeNamespace(req.originalUrl)}:${hash}`;
};

/** Apply the profile's Cache-Control header (production only; dev = no-store). */
const applyCacheHeader = (res, profile) => {
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return;
  }
  const header = profile.http && HTTP_CACHE_HEADERS[profile.http];
  if (header) {
    res.setHeader('Cache-Control', header);
    res.setHeader('Vary', 'Accept-Encoding');
  }
};

export const httpCache = (profileName) => {
  const profile = CACHE_PROFILES[profileName];
  if (!profile) {
    throw new Error(`[httpCache] unknown cache profile '${profileName}'. Add it to config/cacheProfiles.js.`);
  }

  return async (req, res, next) => {
    // Non-GET, kill-switch, admin, and sensitive paths: never cache.
    if (req.method !== 'GET' || isCacheDisabled()) return next();
    if (req.originalUrl.includes('/admin')) return next();
    if (SKIP_PATHS.some((p) => req.originalUrl.includes(p))) return next();

    // Authenticated requests bypass the shared cache and are marked uncacheable
    // downstream so a CDN can't retain user-specific data.
    if (isAuthenticated(req)) {
      res.setHeader('Cache-Control', PRIVATE_NO_STORE);
      return next();
    }

    applyCacheHeader(res, profile);

    // 'lock' profiles are cached by the controller (getWithLock), so we don't
    // read or store here — BUT we still wrap res.json below to enforce the
    // Set-Cookie / non-2xx header guard. Skipping that wrap (as the old code did)
    // let /products emit `public, s-maxage` alongside a Set-Cookie CSRF token —
    // a shared-cache token leak on the busiest route.
    const isLock = profile.strategy === 'lock';

    // Non-lock profiles: try to serve from the shared cache first.
    const key = isLock ? null : buildResponseKey(req, profile);
    if (!isLock) {
      try {
        const cached = await cacheService.get(key);
        if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(cached);
        }
      } catch (err) {
        console.warn('[httpCache] GET error, bypassing cache:', err.message);
      }
    }

    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const cacheable =
        res.statusCode >= 200 &&
        res.statusCode < 300 &&
        !res.getHeader('Set-Cookie'); // never cache a response minting a cookie
      if (!cacheable) {
        // Error status or a Set-Cookie response: the public directive was set
        // optimistically before the status/cookie was known — downgrade it so an
        // error or cookie-bearing body is never edge-cached. Applies to lock
        // profiles too (their store is owned by the controller, but the header
        // guard is not).
        res.setHeader('Cache-Control', PRIVATE_NO_STORE);
      } else if (!isLock) {
        try {
          const tags = resolveTags(profile, req, body);
          cacheService.set(key, body, profile.ttl, tags).catch((err) => {
            console.warn('[httpCache] SET error:', err.message);
          });
        } catch (err) {
          console.warn('[httpCache] SET error:', err.message);
        }
      }
      // Lock profiles set their own X-Cache (HIT/MISS) in the controller.
      if (!isLock) res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
};
