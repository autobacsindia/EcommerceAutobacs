/**
 * Enhanced Security Middleware - Final Production Hardening
 * 
 * Addresses critical refinements:
 * - CSRF rate limiting only on failures (not all requests)
 * - Origin validation only for state-changing requests
 * - Configurable trust proxy levels
 * - Cookie expiry alignment
 * - Security headers (Helmet integration)
 * - Security alert system with threshold monitoring
 * 
 * Usage:
 *   import { 
 *     trackCsrfFailure, 
 *     originValidationForMutations,
 *     configureTrustProxy,
 *     applySecurityHeaders,
 *     securityAlerts 
 *   } from './middleware/securityHardeningFinal.js';
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

// ── 1. CSRF Failure Rate Limiter (ONLY on failures) ─────────────────────────

/**
 * CSRF Failure Rate Limiter
 * 
 * CRITICAL: This is NOT applied globally.
 * It's only consumed when CSRF validation actually fails.
 * 
 * This prevents penalizing legitimate users for normal API usage.
 */
const csrfFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 CSRF failures per window
  message: {
    success: false,
    error: {
      code: 'CSRF_RATE_LIMITED',
      message: 'Too many CSRF validation failures. Please refresh the page and try again.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  
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
  }
});

/**
 * Track CSRF failure (call ONLY when CSRF validation fails)
 * 
 * Usage in csrfMiddleware.js:
 *   if (csrfTokenInvalid) {
 *     trackCsrfFailure(req, res, () => {
 *       return res.status(403).json({ ... });
 *     });
 *     return; // Don't call next()
 *   }
 */
export const trackCsrfFailure = (req, res, next) => {
  // Only consume rate limit on actual failures
  csrfFailureLimiter(req, res, () => {
    // If rate limit not exceeded, continue to next handler
    next();
  });
};

// ── 2. Origin Validation (State-Changing Requests Only) ─────────────────────

/**
 * Validate Origin/Referer headers
 * 
 * ONLY enforced for state-changing requests (POST, PUT, DELETE, PATCH)
 * Avoids unnecessary checks on safe requests (GET, HEAD, OPTIONS)
 */
export const originValidationForMutations = (req, res, next) => {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  const origin = req.headers.origin || req.headers.referer;
  
  // Only enforce if header exists (avoid false positives)
  if (origin && !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
    console.warn('[Security] Origin mismatch:', {
      origin: origin.substring(0, 100),
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
  
  next();
};

// ── 3. Configurable Trust Proxy ─────────────────────────────────────────────

/**
 * Configure trust proxy for correct IP detection
 * 
 * Proxy trust levels:
 * - 1: Trust first proxy only (Nginx, single LB)
 * - 2: Trust first 2 proxies (Cloudflare + Nginx)
 * - true: Trust all proxies (use only if you control entire chain)
 * 
 * Common setups:
 * - Nginx only → 1
 * - Cloudflare + Nginx → 2 or true
 * - Railway/Heroku → true (they set headers correctly)
 * - AWS ALB → 1
 */
export const configureTrustProxy = (app, trustLevel = 1) => {
  app.set('trust proxy', trustLevel);
  
  const trustDesc = trustLevel === true ? 'all proxies' : `${trustLevel} hop(s)`;
  console.log(`[Security] Trust proxy configured (${trustDesc})`);
};

// ── 4. Cookie Expiry Alignment Helper ───────────────────────────────────────

/**
 * Cookie expiry configuration (aligned)
 * 
 * Prevents:
 * - Stale CSRF tokens
 * - Mismatched sessions
 * - Orphaned refresh tokens
 */
export const COOKIE_EXPIRY = {
  session: 7 * 24 * 60 * 60 * 1000,        // 7 days
  csrfToken: 7 * 24 * 60 * 60 * 1000,      // Same as session
  refreshToken: 30 * 24 * 60 * 60 * 1000,  // 30 days (longer for UX)
  shortLived: 1 * 60 * 60 * 1000           // 1 hour (for sensitive operations)
};

/**
 * Set cookies with aligned expiry times
 */
export const setAlignedCookies = (res, cookies) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Session cookie - Lax for better UX
  if (cookies.session) {
    res.cookie('sessionId', cookies.session, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: cookies.sessionMaxAge || COOKIE_EXPIRY.session
    });
  }
  
  // CSRF token cookie - MUST match session expiry
  if (cookies.csrfToken) {
    res.cookie('XSRF-TOKEN', cookies.csrfToken, {
      httpOnly: false, // Must be readable by frontend
      secure: isProduction,
      sameSite: 'strict', // Stricter for CSRF token
      path: '/',
      maxAge: cookies.csrfTokenMaxAge || COOKIE_EXPIRY.csrfToken // Same as session!
    });
  }
  
  // Refresh token - Longer expiry
  if (cookies.refreshToken) {
    res.cookie('refreshToken', cookies.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: cookies.refreshTokenMaxAge || COOKIE_EXPIRY.refreshToken
    });
  }
};

// ── 5. Security Headers (Helmet Integration) ────────────────────────────────

/**
 * Apply security headers using Helmet
 * 
 * Adds:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: SAMEORIGIN (clickjacking protection)
 * - Strict-Transport-Security (HSTS)
 * - Content-Security-Policy (CSP)
 * - Referrer-Policy
 * - X-DNS-Prefetch-Control
 * - X-Download-Options
 * - X-Permitted-Cross-Domain-Policies
 */
export const applySecurityHeaders = async () => {
  try {
    const helmet = await import('helmet');
    
    return helmet.default({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // Next.js needs unsafe-inline
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: ["'self'", process.env.BACKEND_URL || 'https://api.autobacs.in'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"] // Prevent clickjacking
        }
      },
      crossOriginEmbedderPolicy: false, // May break some features
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });
  } catch (error) {
    console.warn('[Security] Helmet not available, skipping:', error.message);
    return (req, res, next) => next(); // Fallback: no-op middleware
  }
};

// ── 6. Security Alert System ────────────────────────────────────────────────

/**
 * Alert system for security events
 * 
 * Triggers alerts when thresholds exceeded:
 * - 50+ CSRF failures/min → Critical alert
 * - 20+ Origin mismatches/min → Warning alert
 * - Sudden spike in any security event → Investigate
 * 
 * Integration points:
 * - Email (nodemailer)
 * - Slack/Discord webhook
 * - PagerDuty
 * - Custom monitoring service
 */
class SecurityAlertSystem {
  constructor() {
    this.counters = new Map();
    this.alertThresholds = {
      csrfFailures: { warning: 20, critical: 50, windowMs: 60 * 1000 },
      originMismatches: { warning: 20, critical: 50, windowMs: 60 * 1000 },
      rateLimitExceeded: { warning: 30, critical: 100, windowMs: 60 * 1000 },
      fieldInjectionAttempts: { warning: 10, critical: 30, windowMs: 60 * 1000 }
    };
    
    this.alertHandlers = [];
  }
  
  /**
   * Register alert handler (email, Slack, etc.)
   */
  onAlert(handler) {
    this.alertHandlers.push(handler);
  }
  
  /**
   * Track security event
   */
  track(eventType, details = {}) {
    const now = Date.now();
    
    // Initialize counter if needed
    if (!this.counters.has(eventType)) {
      this.counters.set(eventType, []);
    }
    
    const timestamps = this.counters.get(eventType);
    
    // Remove old entries outside window
    const threshold = this.alertThresholds[eventType];
    if (threshold) {
      const windowStart = now - threshold.windowMs;
      this.counters.set(eventType, timestamps.filter(t => t > windowStart));
    }
    
    // Add current event
    timestamps.push(now);
    
    // Check thresholds
    if (threshold) {
      const count = timestamps.length;
      
      if (count >= threshold.critical) {
        this.triggerAlert('critical', eventType, count, details);
      } else if (count >= threshold.warning) {
        this.triggerAlert('warning', eventType, count, details);
      }
    }
  }
  
  /**
   * Trigger alert
   */
  triggerAlert(severity, eventType, count, details) {
    const alert = {
      severity,
      eventType,
      count,
      timestamp: new Date().toISOString(),
      details
    };
    
    console.error(`[Security Alert] ${severity.toUpperCase()}:`, alert);
    
    // Send to registered handlers
    this.alertHandlers.forEach(handler => {
      try {
        handler(alert);
      } catch (error) {
        console.error('[Security] Alert handler failed:', error.message);
      }
    });
  }
  
  /**
   * Get current counts
   */
  getCounts() {
    const counts = {};
    for (const [eventType, timestamps] of this.counters.entries()) {
      counts[eventType] = timestamps.length;
    }
    return counts;
  }
}

// Singleton instance
export const securityAlerts = new SecurityAlertSystem();

// ── 7. Safe Security Logger (Updated) ───────────────────────────────────────

export const safeSecurityLogger = {
  csrfFailure: (req, details = {}) => {
    console.error('[Security] CSRF validation failed:', {
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      ip: req.ip,
      origin: req.headers.origin?.substring(0, 100) || 'none',
      hasAuthHeader: !!req.headers.authorization,
      hasCookie: !!req.cookies?.['XSRF-TOKEN'],
      hasHeaderToken: !!req.headers['x-xsrf-token'],
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown',
      ...details
    });
    
    // Track for alerting
    securityAlerts.track('csrfFailures', { ip: req.ip, path: req.path });
  },

  originMismatch: (req) => {
    console.warn('[Security] Origin validation failed:', {
      timestamp: new Date().toISOString(),
      origin: (req.headers.origin || req.headers.referer || 'none').substring(0, 100),
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
    
    // Track for alerting
    securityAlerts.track('originMismatches', { ip: req.ip, path: req.path });
  },

  rateLimitExceeded: (req, limitType) => {
    console.warn('[Security] Rate limit exceeded:', {
      timestamp: new Date().toISOString(),
      type: limitType,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
    
    // Track for alerting
    securityAlerts.track('rateLimitExceeded', { type: limitType, ip: req.ip });
  },

  fieldInjectionAttempt: (req, unknownFields) => {
    console.warn('[Security] Unknown fields rejected:', {
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      ip: req.ip,
      unknownFields: unknownFields.slice(0, 10),
      userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
    });
    
    // Track for alerting
    securityAlerts.track('fieldInjectionAttempts', { ip: req.ip, fields: unknownFields.length });
  }
};

// ── 8. Usage Example for csrfMiddleware.js ──────────────────────────────────

/**
 * Example: How to integrate into csrfMiddleware.js
 * 
 * import { trackCsrfFailure, safeSecurityLogger } from './securityHardeningFinal.js';
 * 
 * export const csrfProtection = (req, res, next) => {
 *   // ... existing logic ...
 *   
 *   if (!expectedToken || !actualToken || expectedToken !== actualToken) {
 *     // Log safely
 *     safeSecurityLogger.csrfFailure(req);
 *     
 *     // Track failure for rate limiting (ONLY on failure)
 *     trackCsrfFailure(req, res, () => {
 *       // Rate limit not exceeded yet
 *       return res.status(403).json({
 *         success: false,
 *         error: { code: 'CSRF_TOKEN_INVALID', message: 'CSRF token missing or invalid' }
 *       });
 *     });
 *     return; // Don't call next()
 *   }
 *   
 *   next();
 * };
 */
