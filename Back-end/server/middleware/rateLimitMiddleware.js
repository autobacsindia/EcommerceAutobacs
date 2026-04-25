// Rate limiting middleware to prevent API abuse
// Implements sliding window algorithm with burst capacity support
//
// Store: Redis (ioredis / Railway) when REDIS_URL is set, in-memory Map as fallback.
// Redis ensures rate limit state survives restarts and is shared across instances.

import rateLimitEventEmitter from '../services/rateLimitEventEmitter.js';
import adaptiveThrottlingService from '../services/adaptiveThrottlingService.js';
import Redis from 'ioredis';

// ── Redis client ───────────────────────────────────────────────────────
let redisClient = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 5000, // 5s timeout for initial connection
      commandTimeout: 2000, // 2s per command (reasonable for production)
      // Add TLS support for Redis (required for most cloud providers)
      tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
    });
    redisClient.on('error', (err) => {
      console.warn('[RateLimit] Redis error:', err.message);
    });
    console.log('[RateLimit] Redis client initialised (ioredis / Railway)');
  } catch (err) {
    console.warn('[RateLimit] Redis init failed – falling back to in-memory store:', err.message);
  }
} else {
  console.log('[RateLimit] REDIS_URL not set – using in-memory store (single-instance only)');
}

const rateLimitStore = new Map(); // in-memory fallback

// Simple rate limiter with Redis-backed store and in-memory fallback
export const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    burst = null, // Optional burst capacity
    message = 'Too many requests, please try again later',
    keyGenerator, // Function to generate custom keys
    handler = null  // Optional custom rate-limit handler
  } = options;

  return async (req, res, next) => {
    // Bypass rate limiting in test environment
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    // Check for adaptive throttling adjustments
    const endpoint = req.originalUrl || req.url;
    const adjustedMax = adaptiveThrottlingService.getAdjustedLimit(endpoint, max);
    const effectiveMax = adjustedMax;

    // Generate key based on IP (prioritize Cloudflare header if available)
    const baseKey = keyGenerator
      ? keyGenerator(req)
      : req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);

    // ── Redis path: atomic INCR + EXPIRE ───────────────────────────────────────
    if (redisClient) {
      try {
        const redisKey = `rl:${baseKey}`;
        // INCR is atomic. Set TTL on first increment only.
        // If expire fails, delete the key to avoid a permanent block.
        const count = await redisClient.incr(redisKey);
        if (count === 1) {
          try {
            await redisClient.expire(redisKey, windowSec);
          } catch (expireErr) {
            // expire failed — delete the key so it doesn't become permanent
            await redisClient.del(redisKey).catch(() => {});
            console.warn('[RateLimit] expire failed, key deleted to prevent permanent block:', expireErr.message);
            return next();
          }
        }
        // TTL remaining
        const ttl = count === 1 ? windowSec : await redisClient.ttl(redisKey);
        const resetTime = now + ttl * 1000;

        res.set('X-RateLimit-Limit', effectiveMax.toString());
        res.set('X-RateLimit-Remaining', Math.max(0, effectiveMax - count).toString());
        res.set('X-RateLimit-Reset', new Date(resetTime).toISOString());

        if (count > effectiveMax) {
          const retryAfter = ttl > 0 ? ttl : 1;
          rateLimitEventEmitter.emitBlock({
            endpoint,
            method: req.method,
            ipAddress: req.ip || req.connection.remoteAddress,
            userId: req.user?.id || req.user?._id,
            userEmail: req.user?.email,
            limitType: 'window',
            currentLimit: effectiveMax,
            attemptCount: count,
            retryAfter,
            userAgent: req.get('user-agent'),
            deviceInfo: req.get('user-agent'),
            adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
          });

          res.set('Retry-After', retryAfter.toString());
          res.set('X-RateLimit-Remaining', '0');

          if (handler) return handler(req, res);
          return res.status(429).json({
            success: false,
            message,
            rateLimitInfo: { retryAfter, resetTime, type: 'window' }
          });
        }

        rateLimitEventEmitter.emitHit({
          endpoint,
          method: req.method,
          ipAddress: req.ip || req.connection.remoteAddress,
          userId: req.user?.id || req.user?._id,
          userEmail: req.user?.email,
          limitType: 'window',
          currentLimit: effectiveMax,
          attemptCount: count,
          userAgent: req.get('user-agent'),
          deviceInfo: req.get('user-agent'),
          adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
        });

        return next();
      } catch (err) {
        // Redis error – fail open (allow request) and log
        console.warn('[RateLimit] Redis error, allowing request:', err.message);
        return next();
      }
    }

    // ── In-memory fallback path (single-instance only) ────────────────────────
    // Clean up old entries
    for (const [key, value] of rateLimitStore.entries()) {
      if (now - value.resetTime > windowMs) {
        rateLimitStore.delete(key);
      }
    }

    // Get or create record for this key
    if (!rateLimitStore.has(baseKey)) {
      rateLimitStore.set(baseKey, {
        count: 1,
        burstCount: burst ? 1 : 0,
        resetTime: now,
        burstResetTime: now
      });
      
      // Emit rate limit hit event
      rateLimitEventEmitter.emitHit({
        endpoint: req.originalUrl || req.url,
        method: req.method,
        ipAddress: req.ip || req.connection.remoteAddress,
        userId: req.user?.id || req.user?._id,
        userEmail: req.user?.email,
        limitType: 'window',
        currentLimit: effectiveMax,
        attemptCount: 1,
        userAgent: req.get('user-agent'),
        deviceInfo: req.get('user-agent'),
        adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
      });
      
      // Add rate limit headers for successful requests
      res.set('X-RateLimit-Limit', effectiveMax.toString());
      res.set('X-RateLimit-Remaining', (effectiveMax - 1).toString());
      res.set('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      if (burst) {
        res.set('X-RateLimit-Burst-Limit', burst.toString());
        res.set('X-RateLimit-Burst-Remaining', (burst - 1).toString());
      }
      
      return next();
    }

    const record = rateLimitStore.get(baseKey);

    // Reset if window has passed
    if (now - record.resetTime > windowMs) {
      record.count = 1;
      record.resetTime = now;
      
      // Add rate limit headers for successful requests
      res.set('X-RateLimit-Limit', effectiveMax.toString());
      res.set('X-RateLimit-Remaining', (effectiveMax - 1).toString());
      res.set('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      if (burst) {
        res.set('X-RateLimit-Burst-Limit', burst.toString());
        res.set('X-RateLimit-Burst-Remaining', (burst - 1).toString());
      }
      
      return next();
    }

    // Check burst capacity (for sub-second traffic spikes)
    if (burst) {
      const burstWindow = 1000; // 1 second burst window
      if (now - record.burstResetTime > burstWindow) {
        record.burstCount = 1;
        record.burstResetTime = now;
      } else {
        record.burstCount++;
        if (record.burstCount > burst) {
          const retryAfter = Math.ceil((record.burstResetTime + burstWindow - now) / 1000);
          
          // Emit rate limit block event
          rateLimitEventEmitter.emitBlock({
            endpoint: req.originalUrl || req.url,
            method: req.method,
            ipAddress: req.ip || req.connection.remoteAddress,
            userId: req.user?.id || req.user?._id,
            userEmail: req.user?.email,
            limitType: 'burst',
            currentLimit: burst,
            attemptCount: record.burstCount,
            retryAfter,
            userAgent: req.get('user-agent'),
            deviceInfo: req.get('user-agent')
          });
          
          res.set('Retry-After', retryAfter.toString());
          res.set('X-RateLimit-Burst-Limit', burst.toString());
          res.set('X-RateLimit-Burst-Remaining', '0');
          
          return res.status(429).json({
            success: false,
            message: 'Burst rate limit exceeded. Please slow down.',
            rateLimitInfo: {
              retryAfter,
              resetTime: record.burstResetTime + burstWindow,
              type: 'burst'
            }
          });
        }
      }
    }

    // Increment request count
    record.count++;

    // Check if limit exceeded
    if (record.count > effectiveMax) {
      // Add retry-after header
      const retryAfter = Math.ceil((record.resetTime + windowMs - now) / 1000);
      
      // Emit rate limit block event
      rateLimitEventEmitter.emitBlock({
        endpoint: req.originalUrl || req.url,
        method: req.method,
        ipAddress: req.ip || req.connection.remoteAddress,
        userId: req.user?.id || req.user?._id,
        userEmail: req.user?.email,
        limitType: 'window',
        currentLimit: effectiveMax,
        attemptCount: record.count,
        retryAfter,
        userAgent: req.get('user-agent'),
        deviceInfo: req.get('user-agent'),
        adaptiveProfileActive: adaptiveThrottlingService.isProfileActive()
      });
      
      res.set('Retry-After', retryAfter.toString());
      
      // Add additional rate limit headers
      res.set('X-RateLimit-Limit', effectiveMax.toString());
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', new Date(record.resetTime + windowMs).toISOString());
      
      if (handler) return handler(req, res);
      return res.status(429).json({
        success: false,
        message,
        rateLimitInfo: {
          retryAfter,
          resetTime: record.resetTime + windowMs,
          type: 'window'
        }
      });
    }
    
    // Add rate limit headers for successful requests
    res.set('X-RateLimit-Limit', effectiveMax.toString());
    res.set('X-RateLimit-Remaining', (effectiveMax - record.count).toString());
    res.set('X-RateLimit-Reset', new Date(record.resetTime + windowMs).toISOString());
    if (burst) {
      res.set('X-RateLimit-Burst-Limit', burst.toString());
      res.set('X-RateLimit-Burst-Remaining', Math.max(0, burst - record.burstCount).toString());
    }

    next();
  };
};

// Rate limiting configuration for public endpoints
export const healthCheckRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (reasonable for health checks)
  message: {
    success: false,
    error: 'Too many health check requests',
    message: 'Please reduce health check frequency'
  }
});

export const metricsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute (metrics should be polled infrequently)
  message: {
    success: false,
    error: 'Too many metrics requests',
    message: 'Please reduce metrics polling frequency'
  }
});

// E-commerce specific rate limiters

// Public browsing endpoints (catalog, product pages)
export const publicBrowsingRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute
  burst: 100, // burst up to 100 requests/second
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:public:${req.ip || req.connection.remoteAddress}`
});

// Authenticated user endpoints (cart, profile, wishlist)
export const authenticatedUserRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 600, // 600 requests per minute
  burst: 200, // burst up to 200 requests/second
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:user:${req.user?.id || req.ip}`
});

// Login/Authentication endpoints with exponential backoff
export const authenticationRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // 5 attempts per minute
  message: 'Too many authentication attempts. Please wait before trying again.',
  keyGenerator: (req) => `rate_limit:auth:${req.ip}:${req.body?.email || ''}`
});

// Checkout/Payment APIs
export const checkoutRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  burst: 20, // burst up to 20 requests/second
  message: 'Too many checkout requests. Please slow down to prevent duplicate orders.',
  keyGenerator: (req) => `rate_limit:checkout:${req.user?.id || req.ip}`
});

// Returns API — tighter limit (returns are low-frequency; 15/min leaves plenty of headroom)
export const returnsRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 15, // 15 requests per minute per user/IP
  message: 'Too many return requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:returns:${req.user?.id || req.ip}`,
  // Log every rate-limit block for abuse monitoring
  handler: (req, res) => {
    console.warn(
      `[RateLimit] /returns blocked | IP: ${req.ip} | user: ${req.user?.id || 'unauthenticated'} | ` +
      `UA: ${req.get('user-agent') || 'unknown'}`
    );
    res.status(429).json({
      success: false,
      message: 'Too many return requests. Please slow down.',
      rateLimitInfo: { retryAfter: 60, type: 'returns' }
    });
  }
});

// Admin APIs
export const adminRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  message: 'Too many admin requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:admin:${req.user?.id}`
});

// Enhanced rate limiters for authentication routes
export const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX) || 5, // Configurable limit, default 5
  message: 'Too many registration attempts, please try again later',
  keyGenerator: (req) => `rate_limit:register:${req.ip || req.connection.remoteAddress}`
});

export const loginRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5, // 5 per minute per IP
  message: 'Too many login attempts, please try again later',
  keyGenerator: (req) => `rate_limit:login:${req.ip || req.connection.remoteAddress}`
});

export const failedLoginRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseInt(process.env.FAILED_LOGIN_RATE_LIMIT_MAX) || 5, // 5 per minute per account
  message: 'Too many failed login attempts, account temporarily locked',
  keyGenerator: (req) => `rate_limit:failed_login:${req.ip || req.connection.remoteAddress}:${req.body.email || ''}`
});

// Refresh token endpoint rate limiting (prevent token abuse)
export const refreshTokenRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 refresh attempts per minute (should be enough for normal usage)
  message: 'Too many token refresh attempts. Please wait before trying again.',
  keyGenerator: (req) => `rate_limit:refresh:${req.ip || req.connection.remoteAddress}`
});

// Global fallback rate limiter for ALL API routes (safety net)
export const globalApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes per IP (generous but prevents abuse)
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:global:${req.ip || req.connection.remoteAddress}`,
  // Log excessive usage for monitoring
  handler: (req, res) => {
    console.warn(
      `[RateLimit] Global API limit exceeded | IP: ${req.ip} | Path: ${req.path} | ` +
      `UA: ${req.get('user-agent') || 'unknown'}`
    );
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please slow down.'
    });
  }
});

// Stricter rate limiter for admin routes (higher value targets)
export const adminRouteRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 minutes (stricter than global 500)
  message: 'Too many admin requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:admin:${req.user?.id || req.ip || req.connection.remoteAddress}`,
  // Log excessive admin usage for security monitoring
  handler: (req, res) => {
    console.warn(
      `[RateLimit] Admin route limit exceeded | User: ${req.user?.id || 'unknown'} | IP: ${req.ip} | ` +
      `Path: ${req.path} | UA: ${req.get('user-agent') || 'unknown'}`
    );
    res.status(429).json({
      success: false,
      message: 'Too many admin requests. Please slow down.'
    });
  }
});

// Deprecated - kept for backward compatibility
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Increased from 5 to 10 requests per 15 minutes
  message: 'Too many authentication attempts, please try again later'
});

// Standard rate limit for API routes
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200  // Increased from 100 to 200 requests per 15 minutes
});

// Strict rate limit for costly external API calls (Google Maps, etc.)
// These endpoints cost money per request
export const locationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,  // Only 30 requests per 15 min (prevents Google Maps bill explosion)
  message: 'Too many location requests. Please try again later or contact support.'
});

// Strict rate limit for contact forms (spam prevention)
export const contactFormRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,  // Only 10 submissions per hour per IP
  message: 'Too many contact form submissions. Please wait before trying again.'
});

// Strict rate limit for consultation bookings (spam prevention)
export const consultationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,  // Only 5 bookings per hour per IP
  message: 'Too many consultation requests. Please wait before trying again.'
});

// More permissive rate limit for frequently accessed routes
export const frequentAccessRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Much higher limit for frequently accessed routes
  message: 'Too many requests, please try again later'
});

// More permissive rate limit for wishlist routes since they're frequently accessed
export const wishlistRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increase limit for frequent wishlist operations
  message: 'Too many wishlist requests, please try again later'
});

// Password reset rate limiters (combined IP + email for forgot, IP-only for reset)
export const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes
  message: 'Too many password reset requests. Please try again later',
  // Combined key: IP + email (prevents both IP-based and email-based abuse)
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const email = req.body.email || 'unknown';
    return `rate_limit:forgot_password:${ip}:${email}`;
  }
});

// CRITICAL: Search endpoint rate limiting (Elasticsearch protection)
// Layered approach: Burst control + sustained rate limiting
export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute (realistic for typing users)
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Identity-based limiting: user ID > guest session > IP
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id;
    const guestSession = req.cookies?.guest_session;
    const ip = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    
    return `rate_limit:search:${userId || guestSession || ip}`;
  }
});

// Burst control: Prevent sudden spikes (20 requests per 10 seconds)
export const searchBurstLimit = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 20, // 20 requests per 10 seconds
  message: {
    success: false,
    message: 'Search requests too fast. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id;
    const guestSession = req.cookies?.guest_session;
    const ip = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    
    return `rate_limit:search_burst:${userId || guestSession || ip}`;
  }
});

export const resetPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes
  message: 'Too many password reset attempts. Please try again later',
  keyGenerator: (req) => `rate_limit:reset_password:${req.ip || req.connection.remoteAddress}`
});

// Email verification rate limiters
export const resendVerificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes
  message: 'Too many verification email requests. Please wait before requesting again',
  keyGenerator: (req) => {
    const email = req.body?.email || req.user?.email || '';
    return `rate_limit:resend_verification:${req.ip || req.connection.remoteAddress}:${email}`;
  }
});

export const verifyEmailRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes (allow retries)
  message: 'Too many verification attempts. Please try again later',
  keyGenerator: (req) => `rate_limit:verify_email:${req.ip || req.connection.remoteAddress}`
});

// UGC submission rate limiters — reviews, questions, and admin answers
export const reviewSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 review submissions per 10 min per authenticated user
  message: 'Too many review submissions. Please wait before submitting again.',
  keyGenerator: (req) => `rate_limit:review_submit:${req.user?._id || req.ip}`
});

export const questionSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 questions per 10 min per IP (public endpoint)
  message: 'Too many question submissions. Please wait before asking again.',
  keyGenerator: (req) => `rate_limit:question_submit:${req.ip || req.connection.remoteAddress}`
});

export const questionAnswerRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 admin answers per 10 min
  message: 'Too many answer submissions. Please slow down.',
  keyGenerator: (req) => `rate_limit:question_answer:${req.user?._id || req.ip}`
});