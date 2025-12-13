// Rate limiting middleware to prevent API abuse

const rateLimitStore = new Map();

// Simple in-memory rate limiter
export const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    message = 'Too many requests, please try again later',
    keyGenerator // Function to generate custom keys
  } = options;

  return (req, res, next) => {
    // Generate key based on IP and optional key generator
    const baseKey = keyGenerator ? keyGenerator(req) : req.ip || req.connection.remoteAddress;
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
        resetTime: now
      });
      
      // Add rate limit headers for successful requests
      res.set('X-RateLimit-Limit', max.toString());
      res.set('X-RateLimit-Remaining', (max - 1).toString());
      res.set('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      
      return next();
    }

    const record = rateLimitStore.get(baseKey);

    // Reset if window has passed
    if (now - record.resetTime > windowMs) {
      record.count = 1;
      record.resetTime = now;
      
      // Add rate limit headers for successful requests
      res.set('X-RateLimit-Limit', max.toString());
      res.set('X-RateLimit-Remaining', (max - 1).toString());
      res.set('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      
      return next();
    }

    // Increment request count
    record.count++;

    // Check if limit exceeded
    if (record.count > max) {
      // Add retry-after header
      const retryAfter = Math.ceil((record.resetTime + windowMs - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      
      // Add additional rate limit headers
      res.set('X-RateLimit-Limit', max.toString());
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', new Date(record.resetTime + windowMs).toISOString());
      
      return res.status(429).json({
        success: false,
        message,
        rateLimitInfo: {
          retryAfter,
          resetTime: record.resetTime + windowMs
        }
      });
    }
    
    // Add rate limit headers for successful requests
    res.set('X-RateLimit-Limit', max.toString());
    res.set('X-RateLimit-Remaining', (max - record.count).toString());
    res.set('X-RateLimit-Reset', new Date(record.resetTime + windowMs).toISOString());

    next();
  };
};

// Enhanced rate limiters for authentication routes
export const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX) || 5, // Configurable limit, default 5
  message: 'Too many registration attempts, please try again later',
  keyGenerator: (req) => `rate_limit:register:${req.ip || req.connection.remoteAddress}`
});

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 10, // Configurable limit, default 10
  message: 'Too many login attempts, please try again later',
  keyGenerator: (req) => `rate_limit:login:${req.ip || req.connection.remoteAddress}`
});

export const failedLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.FAILED_LOGIN_RATE_LIMIT_MAX) || 5, // Configurable limit, default 5
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