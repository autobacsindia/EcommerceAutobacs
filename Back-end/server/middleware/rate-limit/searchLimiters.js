import { rateLimit } from './core.js';

export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id;
    const guestSession = req.cookies?.guest_session;
    const ip = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
    return `rate_limit:search:${userId || guestSession || ip}`;
  }
});

export const searchBurstLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 40,
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
