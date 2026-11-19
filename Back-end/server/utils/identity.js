/**
 * Identity normalization for CRM lead deduplication.
 *
 * A "person" across lead sources is keyed by a stable identity: email is the
 * strongest signal, phone is the fallback (consultations capture phone-only,
 * dormant users email-only). These helpers produce the canonical forms used for
 * dedup and the `identityKey` that the Lead upsert is keyed on.
 */

/** Lowercase + trim an email, or null when absent/blank. */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

/**
 * Reduce a phone number to comparable digits. Strips spaces, dashes, brackets and
 * a leading `+`; keeps a trailing significant suffix so `+91 98765 43210` and
 * `09876543210` collapse toward the same key. Returns null when there aren't
 * enough digits to be a real number.
 */
export function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  // India numbers are 10 significant digits; drop a country/trunk prefix so
  // 91XXXXXXXXXX / 0XXXXXXXXXX / XXXXXXXXXX all match on the last 10.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * An Indian mobile number in E.164 (`+919876543210`), or null.
 *
 * For sending to WhatsApp, so stricter than normalizePhone: it accepts only the
 * shapes an Indian mobile is actually written in — 10 digits, 0 + 10, or 91 + 10,
 * with any spaces, dashes, brackets or a leading `+` — and the 10 digits must start
 * 6–9 (every Indian mobile series). Anything else (a landline, a foreign number, a
 * typo with 9 or 11 digits) returns null so the caller skips the message rather than
 * guessing at someone else's number.
 * @param {string} phone
 * @returns {string|null}
 */
export function toE164India(phone) {
  if (phone == null) return null;
  const digits = String(phone).replace(/\D/g, '');
  let national = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  if (!national || !/^[6-9]\d{9}$/.test(national)) return null;
  return `+91${national}`;
}

/**
 * Canonical dedup key for a lead identity. Prefers email; falls back to a
 * phone-scoped key. Returns null when neither is usable (caller should skip).
 */
export function buildIdentityKey({ email, phone } = {}) {
  const e = normalizeEmail(email);
  if (e) return `email:${e}`;
  const p = normalizePhone(phone);
  if (p) return `phone:${p}`;
  return null;
}

/** Escape a string for safe use as a literal inside a RegExp (injection/ReDoS guard). */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex SOURCE that matches a phone number tolerant of the separators
 * and country/trunk prefixes that stored values carry — `+91 98765 43210`,
 * `09876543210` and the normalized `9876543210` all match the same query. Each
 * significant digit is separated by `\D*` so only digits are compared. Returns
 * null when `search` isn't phone-like (< 7 digits), so callers can fall back to
 * plain text search. The `\D*` runs are each followed by a required literal
 * digit, so there's no catastrophic backtracking, and inputs are short.
 */
export function phoneSearchPattern(search) {
  const normalized = normalizePhone(search);
  if (!normalized) return null;
  return normalized.split('').join('\\D*');
}
