import { rateLimit } from './core.js';

export const globalApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 500 : 10000,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:global:${req.ip || req.connection.remoteAddress}`,
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

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});

export const frequentAccessRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests, please try again later'
});

export const healthCheckRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: 'Too many health check requests',
    message: 'Please reduce health check frequency'
  }
});

export const metricsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too many metrics requests',
    message: 'Please reduce metrics polling frequency'
  }
});
