import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

/*
 * HR API (routes/hr/*). Mounted after `protect`, so each person gets their own
 * bucket; the real client IP (cf-connecting-ip via getClientIp) is the fallback
 * key — never req.ip, which behind Cloudflare is the edge.
 */

// Everything under /hr: panel screens and the app's reads.
export const hrRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests. Please wait a minute.',
  keyGenerator: (req) => `rate_limit:hr:${req.user?.id || getClientIp(req)}`,
});

// Clock in/out, breaks, face enrol/verify: a person punches a few times a day;
// an offline sync may send a small batch. A loop or a brute-force face attempt is not normal.
export const hrPunchRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many attempts. Please wait a few minutes and try again.',
  keyGenerator: (req) => `rate_limit:hr-punch:${req.user?.id || getClientIp(req)}`,
});
