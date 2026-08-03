/**
 * Trusted internal caller detection for rate limiting.
 *
 * WHY: the public limiters key on `req.ip`. That is correct for browser traffic,
 * but the Next.js frontend also calls this API *server-side* (SSR, ISR
 * revalidation, generateMetadata, sitemap). Those requests all leave Vercel from
 * a small pool of egress IPs, so every server-rendered page in the fleet shares a
 * single 300 req/min bucket. Under real load that returns 429 to our own
 * frontend while individual browsers are nowhere near their limit — an outage
 * that looks like nothing is wrong.
 *
 * FIX: the frontend proves it is our own server with a shared secret; those
 * requests get their own bucket with a much larger allowance. This is a DoS
 * backstop, not per-user fairness — abusive traffic against server-rendered
 * pages is Cloudflare's job at the edge, where the real client IP is visible.
 *
 * SAFETY: with INTERNAL_API_KEY unset (the default) nothing is ever trusted and
 * behaviour is byte-identical to before, so this can ship ahead of the env var.
 * The key only relaxes rate limits — it grants no authentication or authorisation.
 */

import crypto from 'crypto';

/** Reject trivially guessable keys outright rather than pretending they help. */
const MIN_KEY_LENGTH = 24;

/** Multiplier applied to a limiter's max for trusted internal callers. */
export const getInternalRateMultiplier = () => {
  const raw = parseInt(process.env.INTERNAL_RATE_LIMIT_MULTIPLIER, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
};

/** Constant-time string compare that tolerates length mismatch. */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * True when the request carries the shared internal key.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export const isTrustedInternalClient = (req) => {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) return false;

  const presented = req.headers['x-internal-key'];
  if (!presented || typeof presented !== 'string') return false;

  return safeEqual(presented, expected);
};
