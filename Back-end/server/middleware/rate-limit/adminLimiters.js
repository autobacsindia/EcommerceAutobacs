import { rateLimit } from './core.js';

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
  keyGenerator: (req) => `rate_limit:admin:${req.user?.id || req.ip || req.connection.remoteAddress}`,
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
