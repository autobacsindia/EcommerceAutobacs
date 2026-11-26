/**
 * Input checks for the supplier API. Hand-rolled on purpose: every body is an
 * ALLOW-LIST, and anything not on it is refused (400 UNKNOWN_FIELDS) rather than
 * silently dropped — so a client that sends `price`, `sellingPrice`, `productId`,
 * `status` or `supplierAccount` learns at once that it cannot set them.
 */
import { fail } from './errors.js';

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NO_RE = /^[0-9]{9,18}$/;
export const UPI_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Refuse a body (or sub-object) with any key outside `allowed`. */
export function onlyKeys(body, allowed, where = 'body') {
  if (!isPlainObject(body)) throw fail(400, 'BAD_BODY', 'Send the details as a JSON object.');
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw fail(400, 'UNKNOWN_FIELDS', `These fields cannot be set here: ${unknown.join(', ')}.`, { fields: unknown, where });
  }
}

/** Trimmed string within [min, max] characters; '' allowed when min is 0. */
export function str(value, label, { min = 0, max }) {
  if (typeof value !== 'string') throw fail(400, 'INVALID_FIELD', `${label} must be text.`, { field: label });
  const v = value.trim();
  if (v.length < min) throw fail(400, 'INVALID_FIELD', min > 1 ? `${label} needs at least ${min} characters.` : `${label} is required.`, { field: label });
  if (v.length > max) throw fail(400, 'INVALID_FIELD', `${label} can be at most ${max} characters.`, { field: label });
  return v;
}

export function int(value, label, { min, max }) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw fail(400, 'INVALID_FIELD', `${label} must be a whole number from ${min} to ${max}.`, { field: label });
  }
  return value;
}

export function oneOf(value, label, allowed) {
  if (!allowed.includes(value)) throw fail(400, 'INVALID_FIELD', `${label} must be one of: ${allowed.join(', ')}.`, { field: label });
  return value;
}

/** Indian mobile/landline as typed → digits only (a leading +91 / 0 is dropped). */
export function phone(value) {
  const digits = str(value, 'Phone', { min: 1, max: 20 }).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  if (!/^[0-9]{10}$/.test(digits)) throw fail(400, 'INVALID_FIELD', 'Phone must be a 10-digit number.', { field: 'Phone' });
  return digits;
}

export function email(value) {
  const v = str(value, 'Email', { min: 3, max: 160 });
  if (!EMAIL_RE.test(v)) throw fail(400, 'INVALID_FIELD', 'Enter a valid email address.', { field: 'Email' });
  return v;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw fail(400, 'WEAK_PASSWORD', 'Password needs at least 8 characters.');
  }
  // bcrypt reads only the first 72 bytes; refusing longer stops two "different"
  // passwords from silently being the same one.
  if (Buffer.byteLength(value, 'utf8') > 72) throw fail(400, 'WEAK_PASSWORD', 'Password can be at most 72 characters.');
  return value;
}

export function sixDigitCode(value) {
  const v = typeof value === 'number' ? String(value).padStart(6, '0') : String(value ?? '').trim();
  if (!/^[0-9]{6}$/.test(v)) throw fail(400, 'INVALID_CODE', 'Enter the 6-digit code from the email.');
  return v;
}
