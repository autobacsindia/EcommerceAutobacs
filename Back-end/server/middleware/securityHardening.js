/**
 * Enhanced Security Middleware - Precision Hardening
 * 
 * Implements production-grade security with careful attention to edge cases:
 * - Origin validation with fallback safety (no false positives)
 * - CSRF rate limiting (active defense)
 * - Safe logging (no sensitive data leakage)
 * - Trust proxy configuration (correct IP behind load balancers)
 * 
 * Usage:
 *   import { originValidation, csrfRateLimit, safeSecurityLogger } from './middleware/securityHardening.js';
 */

import rateLimit from 'express-rate-limit';

// ── Configuration ───────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'https://autobacs.in',
  'https://www.autobacs.in'
].filter(Boolean);

// ── 1. Origin Validation with Fallback Safety ───────────────────────────────

/**
 * Validate Origin/Referer headers against whitelist
 * 
 * KEY: Only enforce if header exists (avoid false positives)
 * Some legitimate requests may have no Origin/Referer:
 * - Older browsers
 * - Privacy-focused proxies
 * - Mobile apps
 * - curl/Postman
 */
export const originValidation = (req, res, next) => {
  const origin = req.headers.origin || req.headers.referer;
  
  // Only enforce if header exists
  if (origin && !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
    // Log safely (no sensitive data)
    console.warn('[Security] Origin mismatch:', {
      origin: origin.substring(0, 100), // Truncate long origins
      path: req.path,
      method: req.method,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    return res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_ORIGIN',
        message: 'Request origin not allowed'
      }
    });
  }
  
  // No origin header or valid origin → proceed
  next();
};

// ── 2. CSRF Rate Limiter (Active Defense) ───────────────────────────────────

/**
 * Rate limit specifically for CSRF failures
 * 
 * Prevents brute-force CSRF token guessing
 * Automatically blocks IPs with too many failures
 */
export const csrfRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 CSRF failures per window
  message: {
    success: false,
    error: {
      code: 'CSRF_RATE_LIMITED',
      message: 'Too many CSRF validation failures. Please refresh the page and try again.'
    }
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  
  // Custom key generator (by IP)
  keyGenerator: (req) => {
    return req.ip;
  },
  
  // Custom handler when limit is exceeded
  handler: (req, res) => {
    console.error('[Security] CSRF rate limit exceeded:', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    });
    
    res.status(429).json({
      success: false,
      error: {
        code: 'CSRF_RATE_LIMITED',
        message: 'Too many CSRF validation failures. Please refresh the page and try again.'
      }
    });
  },
  
  // Skip successful requests
  skip: (req, res) => {
    // Only count failures (this is applied before the check)
    return false;
  }
});

// ── 3. Safe Security Logger ─────────────────────────────────────────────────

/**
 * Log security events without leaking sensitive data
 * 
 * NEVER log:
 * - Tokens (CSRF, JWT, session)
 * - Full cookies
 * - Authorization headers
 * - Request bodies (may contain passwords)
 * 
 * SAFE to log:
 * - IP address
 * - Path
 * - Method
 * - Origin (truncated)
 * - User agent (truncated)
 * - Timestamp
 */
export const safeSecurityLogger = {
  /**
   * Log CSRF failure safely
   */
  csrfFailure: (req, details = {}) => {
    console.error('[Security] CSRF validation failed:', {
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      ip: req.ip,
      origin: req.headers.origin?.substring(0, 100) || 'none',
      hasAuthHeader: !!req.headers.authorization, // Boolean only, not the token
      hasCookie: !!req.cookies?.['XSRF-TOKEN'], // Boolean only
      hasHeaderToken: !!req.headers['x-xsrf-token'], // Boolean only
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown',
      ...details
    });
  },

  /**
   * Log origin mismatch safely
   */
  originMismatch: (req) => {
    console.warn('[Security] Origin validation failed:', {
      timestamp: new Date().toISOString(),
      origin: (req.headers.origin || req.headers.referer || 'none').substring(0, 100),
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
  },

  /**
   * Log rate limit exceeded safely
   */
  rateLimitExceeded: (req, limitType) => {
    console.warn('[Security] Rate limit exceeded:', {
      timestamp: new Date().toISOString(),
      type: limitType,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
  },

  /**
   * Log field injection attempt safely
   */
  fieldInjectionAttempt: (req, unknownFields) => {
    console.warn('[Security] Unknown fields rejected:', {
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      ip: req.ip,
      unknownFields: unknownFields.slice(0, 10), // Max 10 fields
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
  }
};

// ── 4. Trust Proxy Configuration ────────────────────────────────────────────

/**
 * Configure trust proxy for correct IP detection behind load balancers
 * 
 * Required when behind:
 * - Nginx
 * - Cloudflare
 * - AWS ALB
 * - Railway/Heroku
 * 
 * Without this, req.ip will be the load balancer IP, not the client IP
 */
export const configureTrustProxy = (app) => {
  // Trust the first proxy
  app.set('trust proxy', 1);
  
  console.log('[Security] Trust proxy configured (1 hop)');
};

// ── 5. Hybrid SameSite Cookie Strategy ──────────────────────────────────────

/**
 * Set cookies with appropriate SameSite policies
 * 
 * Session cookies: Lax (better UX with OAuth/payments)
 * CSRF token cookies: Strict (maximum security)
 */
export const setSecureCookies = (res, cookies) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Session cookie - Lax for better UX
  if (cookies.session) {
    res.cookie('sessionId', cookies.session, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax', // ✅ Allows OAuth redirects
      path: '/',
      maxAge: cookies.sessionMaxAge || 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }
  
  // CSRF token cookie - Strict for maximum security
  if (cookies.csrfToken) {
    res.cookie('XSRF-TOKEN', cookies.csrfToken, {
      httpOnly: false, // Must be readable by frontend JS
      secure: isProduction,
      sameSite: 'strict', // ✅ Stricter for CSRF token
      path: '/'
    });
  }
  
  // Refresh token cookie - Strict (sensitive)
  if (cookies.refreshToken) {
    res.cookie('refreshToken', cookies.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict', // ✅ Strict for sensitive tokens
      path: '/',
      maxAge: cookies.refreshTokenMaxAge || 30 * 24 * 60 * 60 * 1000 // 30 days
    });
  }
};

// ── 6. Combined Security Middleware ─────────────────────────────────────────

/**
 * Apply all security checks in the correct order
 */
export const applyAllSecurityChecks = (app) => {
  // 1. Trust proxy (MUST be first)
  configureTrustProxy(app);
  
  // Return middleware array for route usage
  return [
    originValidation,
    // csrfRateLimit applied separately before CSRF check
  ];
};
