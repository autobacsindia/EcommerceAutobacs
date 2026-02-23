// Rate limiting middleware to prevent API abuse
// Implements sliding window algorithm with burst capacity support

import rateLimitEventEmitter from '../services/rateLimitEventEmitter.js';
import adaptiveThrottlingService from '../services/adaptiveThrottlingService.js';

const rateLimitStore = new Map();

// Simple in-memory rate limiter with burst capacity
export const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    burst = null, // Optional burst capacity
    message = 'Too many requests, please try again later',
    keyGenerator // Function to generate custom keys
  } = options;

  return (req, res, next) => {
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

// Special rate limiter for location routes with higher limits
export const locationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Higher limit for location endpoints
  message: 'Too many location requests, please try again later'
});

// Password reset rate limiters
export const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes
  message: 'Too many password reset requests. Please try again later',
  keyGenerator: (req) => `rate_limit:forgot_password:${req.ip || req.connection.remoteAddress}`
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