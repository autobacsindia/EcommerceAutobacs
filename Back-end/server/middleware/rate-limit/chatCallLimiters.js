import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

/*
 * Team-chat calls (routes/chat.js). Mounted after `protect`, so each person has
 * their own bucket; the real client IP (cf-connecting-ip via getClientIp) is
 * the fallback key, never req.ip — behind Cloudflare that is the edge.
 */

// Ringing someone: a person pressing Call a few times is normal; a loop is not.
export const callStartRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many calls started. Please wait a minute.',
  keyGenerator: (req) => `rate_limit:chat-call-start:${req.user?.id || getClientIp(req)}`,
});

// Connection setup and heartbeats. A call sends a few dozen signals while it
// connects (ICE candidates are batched) and a heartbeat every 10 s.
export const callSignalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  burst: 100,
  message: 'Too many call messages. Please slow down.',
  keyGenerator: (req) => `rate_limit:chat-call-signal:${req.user?.id || getClientIp(req)}`,
});
