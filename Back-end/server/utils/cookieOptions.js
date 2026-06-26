/**
 * Centralized cookie attributes — domain portability is env-driven, not hardcoded.
 *
 * The app moves Railway → Vercel(frontend) → real domain. Cookie behavior must follow env
 * so each move is a config change, not a code change (see plan).
 *
 *   COOKIE_DOMAIN   – Cookie `Domain` attribute. Unset → host-only (correct for the
 *                     *.railway.app / *.vercel.app interim). Set to ".autobacsindia.com"
 *                     at cutover so cookies are shared across app./api. subdomains.
 *   COOKIE_SAMESITE – "none" (cross-site interim — OAuth redirect lands on the API host
 *                     directly; default in production) | "lax" | "strict".
 *
 * Browser rule: SameSite=None REQUIRES Secure, so `secure` is forced on whenever the
 * resolved SameSite is "none".
 */

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Resolve the SameSite value from env, with safe per-environment defaults.
 * @returns {'lax'|'strict'|'none'}
 */
export function resolveSameSite() {
  const env = process.env.COOKIE_SAMESITE?.toLowerCase();
  if (env === 'lax' || env === 'strict' || env === 'none') return env;
  // Default: cross-site-safe in prod (Vercel↔Railway / OAuth redirects), lax in dev.
  return isProd() ? 'none' : 'lax';
}

/**
 * Build cookie options with env-driven secure/sameSite/domain.
 * Pass per-cookie extras (httpOnly, maxAge, expires, priority, path, and an optional
 * sameSite override for cookies that must differ).
 *
 * @param {object} [extra] - per-cookie overrides
 * @returns {object} options object for res.cookie / res.clearCookie
 */
export function buildCookieOptions(extra = {}) {
  const { sameSite: sameSiteOverride, secure: secureOverride, ...rest } = extra;
  const sameSite = sameSiteOverride || resolveSameSite();
  const secure = secureOverride ?? (sameSite === 'none' ? true : isProd());

  const opts = {
    secure,
    sameSite,
    path: '/',
    ...rest,
  };

  // Authoritative when set, so the cutover is a single env flip.
  if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;

  return opts;
}
