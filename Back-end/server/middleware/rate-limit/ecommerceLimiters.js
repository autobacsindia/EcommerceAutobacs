import { rateLimit } from './core.js';

export const publicBrowsingRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 1000 : 300,
  burst: process.env.NODE_ENV === 'development' ? 200 : 100,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:public:${req.ip || req.connection.remoteAddress}`
});

export const authenticatedUserRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  burst: 200,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:user:${req.user?.id || req.ip}`
});

export const checkoutRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  burst: 20,
  message: 'Too many checkout requests. Please slow down to prevent duplicate orders.',
  keyGenerator: (req) => `rate_limit:checkout:${req.user?.id || req.ip}`
});

export const returnsRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  message: 'Too many return requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:returns:${req.user?.id || req.ip}`,
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

export const wishlistRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many wishlist requests, please try again later'
});

export const contactFormRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many contact form submissions. Please wait before trying again.'
});

export const consultationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many consultation requests. Please wait before trying again.'
});

export const locationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many location requests. Please try again later or contact support.'
});
