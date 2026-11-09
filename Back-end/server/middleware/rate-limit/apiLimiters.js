import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

const logGlobalLimitExceeded = (req, res) => {
  console.warn(
    `[RateLimit] Global API limit exceeded | IP: ${getClientIp(req)} | Path: ${req.path} | ` +
    `UA: ${req.get('user-agent') || 'unknown'}`
  );
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please slow down.'
  });
};

const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Read-only endpoints the staff panel calls by timer, not because a person did
 * anything. Paths are relative to the `/api/v1` mount.
 *
 * They have their own bucket because one office shares one IP: each open panel
 * tab spends about 75 of the 500 site-wide requests per 15 minutes on these two
 * calls alone, so a handful of tabs used to exhaust the bucket, and then every
 * page — products and checkout included — returned 429 for the whole office.
 */
const BACKGROUND_POLL_PATHS = new Set(['/notifications/summary', '/chat/channels']);

export const isBackgroundPoll = (req) =>
  req.method === 'GET' && BACKGROUND_POLL_PATHS.has(req.path);

export const createGlobalApiRateLimit = (siteLimiter, pollLimiter) =>
  Object.assign(
    (req, res, next) => (isBackgroundPoll(req) ? pollLimiter : siteLimiter)(req, res, next),
    { keyGenerator: siteLimiter.keyGenerator },
  );

export const globalApiRateLimit = createGlobalApiRateLimit(
  rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    max: isProduction ? 500 : 10000,
    message: 'Too many requests. Please slow down.',
    keyGenerator: (req) => `rate_limit:global:${getClientIp(req)}`,
    handler: logGlobalLimitExceeded,
  }),
  rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    // Room for about 40 open panel tabs behind one office connection.
    max: isProduction ? 3000 : 10000,
    message: 'Too many requests. Please slow down.',
    keyGenerator: (req) => `rate_limit:global-poll:${getClientIp(req)}`,
    handler: logGlobalLimitExceeded,
  }),
);

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
