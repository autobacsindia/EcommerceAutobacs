import { CODE_MAX_LENGTH, CODE_REGEX, REF_COOKIE_NAME } from '../config/affiliate.js';

/**
 * Read the affiliate referral code the browser is carrying.
 *
 * A deliberate mirror of utils/metaTracking.js: the same "read a first-party cookie,
 * cap it, validate it, return undefined rather than junk" shape, for the same reason —
 * everything here is client-controlled.
 *
 * ── HOW THE COOKIE GETS HERE ─────────────────────────────────────────────────────
 * Front-end/web/src/middleware.ts sets `ab_ref` when someone arrives on `?ref=CODE`.
 * That cookie is HOST-ONLY on the storefront apex, and it still reaches this Express
 * process because the browser never talks to the API host directly: `API_BASE_URL` is
 * the relative `/api/v1`, and next.config.ts rewrites it to the backend, forwarding the
 * Cookie header. The Meta Pixel's `_fbp` — read two files over in metaTracking.js —
 * arrives by exactly the same route and has done so in production for months.
 *
 * So this needs NO `COOKIE_DOMAIN` configuration. Setting one at cutover is fine and
 * changes nothing here; do not make attribution depend on it.
 *
 * ── WHY THE COOKIE IS NOT SIGNED ─────────────────────────────────────────────────
 * The code is public by construction — it is in the URL of every link the affiliate
 * publishes and on every card they hand out. Forging `ab_ref` is exactly equivalent to
 * clicking their link, so an HMAC would protect nothing while adding a shared secret
 * spanning the Vercel edge and Railway. Do not add one.
 *
 * What actually protects the money is that this value is only ever a CLAIM. It is
 * resolved server-side at order time (services/affiliateAttributionService.js), where
 * an unknown, suspended or self-referred code resolves to nothing at all.
 */
export function extractAffiliateRef(req) {
  const raw = req?.cookies?.[REF_COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;

  // Cap BEFORE the regex test. The regex is anchored and bounded, so an unbounded
  // input could only ever fail it — but slicing first keeps a megabyte-long cookie
  // from being handed to the matcher at all.
  const code = raw.trim().toUpperCase().slice(0, CODE_MAX_LENGTH);
  return CODE_REGEX.test(code) ? code : null;
}

export default { extractAffiliateRef };
