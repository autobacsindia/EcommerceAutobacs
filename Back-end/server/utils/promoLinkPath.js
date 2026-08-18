/**
 * Validation for the promo banner's click destination.
 *
 * This value is admin-editable and lands directly in an href, which makes it an
 * open-redirect vector if an absolute URL can ever survive. The rule is
 * therefore an allowlist, not a blocklist: a single leading "/" followed only by
 * characters legal in a path/query/fragment. Anything else is rejected outright.
 *
 * Kept out of the express-validator chain so the same rule can be unit-tested
 * directly and reused if a second admin-set link ever appears.
 */

export const DEFAULT_PROMO_LINK_PATH = '/offers';

/**
 * Characters permitted after the leading slash: RFC 3986 unreserved + sub-delims
 * + the path/query/fragment separators. Notably EXCLUDES backslash, whitespace,
 * and control characters.
 */
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/;

/**
 * True when `value` is a safe same-site relative path.
 *
 * The rejections that matter, and why each is not caught by the regex alone:
 *   - "//evil.com"     protocol-relative. Starts with "/" and contains only legal
 *                      path characters, so SAFE_PATH matches it, yet a browser
 *                      resolves it to https://evil.com. Needs its own check.
 *   - "/\evil.com"     backslash variant of the same trick; excluded from the
 *                      character class, but spelled out here because it is the
 *                      one browsers normalise to a forward slash.
 *   - "https://evil"   absolute URL — no leading "/".
 *   - "javascript:…"   scheme, no leading "/".
 */
export function isSafePromoLinkPath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path || path.length > 512) return false;
  // Must be relative to our own origin.
  if (!path.startsWith('/')) return false;
  // Protocol-relative ("//host") and its backslash equivalents escape the origin
  // despite looking like a path.
  if (/^\/[/\\]/.test(path)) return false;
  return SAFE_PATH.test(path);
}

/**
 * Normalise an incoming link path, falling back to the offers page.
 * Never throws — callers validate first; this only trims and defaults.
 */
export function normalizePromoLinkPath(value) {
  if (typeof value !== 'string') return DEFAULT_PROMO_LINK_PATH;
  const path = value.trim();
  return isSafePromoLinkPath(path) ? path : DEFAULT_PROMO_LINK_PATH;
}

export default { isSafePromoLinkPath, normalizePromoLinkPath, DEFAULT_PROMO_LINK_PATH };
