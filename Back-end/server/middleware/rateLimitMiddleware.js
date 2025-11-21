// Rate limiting middleware to prevent API abuse

const rateLimitStore = new Map();

// Simple in-memory rate limiter
export const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    message = 'Too many requests, please try again later'
  } = options;

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Clean up old entries
    for (const [key, value] of rateLimitStore.entries()) {
      if (now - value.resetTime > windowMs) {
        rateLimitStore.delete(key);
      }
    }

    // Get or create record for this IP
    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, {
        count: 1,
        resetTime: now
      });
      return next();
    }

    const record = rateLimitStore.get(ip);

    // Reset if window has passed
    if (now - record.resetTime > windowMs) {
      record.count = 1;
      record.resetTime = now;
      return next();
    }

    // Increment request count
    record.count++;

    // Check if limit exceeded
    if (record.count > max) {
      return res.status(429).json({
        success: false,
        message
      });
    }

    next();
  };
};

// Stricter rate limit for authentication routes
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Increased from 5 to 10 requests per 15 minutes
  message: 'Too many authentication attempts, please try again later'
});

// Standard rate limit for API routes
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// More permissive rate limit for wishlist routes since they're frequently accessed
export const wishlistRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increase limit for frequent wishlist operations
  message: 'Too many wishlist requests, please try again later'
});