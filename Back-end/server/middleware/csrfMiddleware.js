import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { redisClient, isRedisHealthy } from './rate-limit/redisClient.js';

const CSRF_WINDOW_SEC   = 60;
const CSRF_BLOCK_THRESH = 50;
const CSRF_BLOCK_TTL    = 3600; // 1 hour

// In-memory fallback used only when Redis is unavailable
const fallbackCounts = new Map();
let fallbackCleanupScheduled = false;

function scheduleFallbackCleanup() {
  if (fallbackCleanupScheduled) return;
  fallbackCleanupScheduled = true;
  setInterval(() => fallbackCounts.clear(), CSRF_WINDOW_SEC * 1000);
}

async function trackCsrfFailure(clientIP) {
  if (isRedisHealthy()) {
    try {
      const failKey  = `csrf:fail:${clientIP}`;
      const blockKey = `csrf:block:${clientIP}`;

      const count = await redisClient.incr(failKey);
      if (count === 1) await redisClient.expire(failKey, CSRF_WINDOW_SEC);

      if (count === 10) {
        console.error(`[SECURITY ALERT] Suspicious CSRF activity | IP: ${clientIP} | Failures: ${count}/60s`);
        Sentry.captureMessage('CSRF suspicious activity', {
          level: 'warning',
          extra: { ip: clientIP, count, windowSec: CSRF_WINDOW_SEC },
        });
      } else if (count >= CSRF_BLOCK_THRESH) {
        await redisClient.set(blockKey, '1', 'EX', CSRF_BLOCK_TTL);
        console.error(`[SECURITY ALERT] CSRF attack — IP blocked | IP: ${clientIP} | Failures: ${count}/60s`);
        Sentry.captureMessage('CSRF attack — IP auto-blocked for 1 hour', {
          level: 'error',
          extra: { ip: clientIP, count, blockTtlSec: CSRF_BLOCK_TTL },
        });
      }
      return;
    } catch {
      // Redis error — fall through to in-memory
    }
  }

  // In-memory fallback (single-instance only, no persistence across restarts)
  scheduleFallbackCleanup();
  const key   = `csrf:fail:${clientIP}`;
  const count = (fallbackCounts.get(key) || 0) + 1;
  fallbackCounts.set(key, count);

  if (count === 10) {
    console.error(`[SECURITY ALERT] Suspicious CSRF activity (in-memory) | IP: ${clientIP} | Failures: ${count}/60s`);
  } else if (count >= CSRF_BLOCK_THRESH) {
    console.error(`[SECURITY ALERT] CSRF attack threshold reached (in-memory, no Redis block) | IP: ${clientIP} | Failures: ${count}/60s`);
    Sentry.captureMessage('CSRF attack threshold — Redis unavailable, IP NOT blocked', {
      level: 'error',
      extra: { ip: clientIP, count },
    });
  }
}

/**
 * CSRF Protection Middleware
 * Implements Double-Submit Cookie Pattern
 *
 * 1. Sets a non-httpOnly cookie (XSRF-TOKEN) with a random token
 * 2. Requires state-changing requests (POST, PUT, DELETE, PATCH) to have:
 *    - A matching X-XSRF-TOKEN header
 *    OR
 *    - A valid Authorization header (Bearer token) — assuming API usage
 *
 * Auto-blocking: IPs that exceed 50 CSRF failures within 60 s are added to a
 * Redis blocklist for 1 hour. Blocked IPs receive a plain 403 with no detail.
 */
export const csrfProtection = async (req, res, next) => {
  const clientIP = req.headers['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';

  // ── Blocklist check (fast path) ──────────────────────────────────────────────
  if (isRedisHealthy()) {
    try {
      const blocked = await redisClient.exists(`csrf:block:${clientIP}`);
      if (blocked) {
        return res.status(403).json({ success: false, message: 'CSRF token missing or invalid' });
      }
    } catch {
      // Redis error — fail open to avoid blocking legitimate users
    }
  }

  // ── Generate CSRF cookie if absent ──────────────────────────────────────────
  if (!req.cookies['XSRF-TOKEN']) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', token, {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      httpOnly: false, // Must be readable by frontend JS
      path: '/'
    });
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
  }

  // ── Safe methods ─────────────────────────────────────────────────────────────
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // ── Excluded public paths ────────────────────────────────────────────────────
  const excludedPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/google',
    '/auth/facebook',
    '/auth/google/callback',
    '/auth/facebook/callback',
    '/auth/exchange-code',
    '/api/delivery-zones/check-serviceability',
    '/api/delivery-zones/estimate',
    '/api/delivery-zones/shipping-cost',
    '/api/location/select',
    '/location/select',
    '/consultation',
    '/contact',
  ];

  if (excludedPaths.some(path => req.path.includes(path))) {
    return next();
  }

  // ── Token verification ───────────────────────────────────────────────────────
  const expectedToken = req.cookies['XSRF-TOKEN'];
  const actualToken   = req.headers['x-xsrf-token'];

  if (!actualToken || !expectedToken || expectedToken !== actualToken) {
    console.warn(`[SECURITY] CSRF token mismatch | IP: ${clientIP} | Path: ${req.method} ${req.path}`);

    // Fire-and-forget — don't await so response is not delayed
    trackCsrfFailure(clientIP).catch(() => {});

    // Bearer token exemption (browser never sends these cross-site)
    if (req.headers.authorization?.startsWith('Bearer ')) {
      return next();
    }

    const isUsingCookieAuth = req.cookies['accessToken'] || req.cookies['refreshToken'];
    if (isUsingCookieAuth) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token missing or invalid. Please refresh the page and try again.'
      });
    }

    return res.status(403).json({ success: false, message: 'CSRF token missing or invalid' });
  }

  next();
};

export default csrfProtection;
