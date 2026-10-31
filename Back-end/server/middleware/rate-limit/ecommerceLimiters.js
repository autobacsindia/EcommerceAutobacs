import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

export const publicBrowsingRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 1000 : 300,
  burst: process.env.NODE_ENV === 'development' ? 200 : 100,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:public:${getClientIp(req)}`
});

// GET /payment-config/razorpay — read once per storefront session (the client caches
// it) and edge-cacheable, so real traffic barely reaches the origin. Keyed on
// the real client IP (getClientIp): behind Cloudflare req.ip is the edge, which would put every
// shopper in one bucket.
export const paymentConfigRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 1000 : 120,
  burst: 40,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) =>
    `rate_limit:payment-config:${getClientIp(req)}`
});

export const authenticatedUserRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  burst: 200,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:user:${req.user?.id || getClientIp(req)}`
});

export const checkoutRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  burst: 20,
  message: 'Too many checkout requests. Please slow down to prevent duplicate orders.',
  keyGenerator: (req) => `rate_limit:checkout:${req.user?.id || getClientIp(req)}`
});

export const returnsRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  message: 'Too many return requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:returns:${req.user?.id || getClientIp(req)}`,
  handler: (req, res) => {
    console.warn(
      `[RateLimit] /returns blocked | IP: ${getClientIp(req)} | user: ${req.user?.id || 'unauthenticated'} | ` +
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

/**
 * Support ticket creation and customer replies.
 *
 * Higher than the contact-form limit because this also covers replies on an
 * existing conversation — a customer working through a problem legitimately
 * sends several messages in a session, and rate-limiting someone mid-complaint
 * is its own support incident. Abuse of ticket CREATION specifically is bounded
 * further by the per-ticket outbound loop guard, which caps how much mail any
 * one thread can generate regardless of how many requests arrive.
 */
export const supportSubmitRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many support messages. Please wait before sending another.'
});

/**
 * Spin-to-Win: the wheel click.
 *
 * Deliberately keyed on the REAL client IP (getClientIp), not `req.ip`. Behind Cloudflare `req.ip` is
 * the edge, so every customer in the country shares one bucket and the limiter silently
 * does nothing — a house landmine this repo has already documented. The user id comes
 * first when present; the IP is the fallback that actually has to work.
 *
 * The limit is generous because the endpoint is idempotent (a repeat spin returns the
 * same prize, it does not consume more stock). This exists to stop scripted enumeration
 * of order ids, not to police an impatient customer double-clicking.
 */
export const spinRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: 'Too many spin requests. Please slow down.',
  keyGenerator: (req) =>
    `rate_limit:spin:${req.user?.id || getClientIp(req)}`,
});
