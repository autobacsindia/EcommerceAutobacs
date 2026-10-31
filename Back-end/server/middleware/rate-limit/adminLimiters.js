import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

export const adminRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: 'Too many admin requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:admin:${req.user?.id}`
});

export const adminRouteRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many admin requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:admin:${req.user?.id || getClientIp(req)}`,
  handler: (req, res) => {
    console.warn(
      `[RateLimit] Admin route limit exceeded | User: ${req.user?.id || 'unknown'} | IP: ${getClientIp(req)} | ` +
      `Path: ${req.path} | UA: ${req.get('user-agent') || 'unknown'}`
    );
    res.status(429).json({
      success: false,
      message: 'Too many admin requests. Please slow down.'
    });
  }
});
