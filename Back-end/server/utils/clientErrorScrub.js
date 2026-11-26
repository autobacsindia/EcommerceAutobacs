import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  CLIENT_ERROR_FEATURE_VALUES,
  CLIENT_ERROR_LEVELS,
  CLIENT_ERROR_LIMITS as L,
} from '../config/clientErrors.js';

/**
 * Turns an untrusted storefront error report into something safe to store.
 *
 * The report comes from a public endpoint, so every field is treated as hostile:
 * types are checked, lengths capped, and anything that could identify a person
 * or unlock something is removed BEFORE it is stored — emails, phone and card
 * numbers, JWTs and long tokens, `password=`/`token=` pairs, and every query
 * string (payment links and reset links carry secrets there).
 *
 * Pure functions: no database, no clock except where passed in.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// name=value pairs whose value is a secret or personal (password=…, "token": "…", otp: 1234).
const SECRET_PAIR = /\b(pass(?:word|wd)?|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|signature|sig|otp|cvv|card(?:number)?|auth(?:orization)?|cookie|session|email|phone|mobile|contact|upi|vpa|gstin)\b(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi;
// Card numbers, phone numbers, Aadhaar: 8+ digits, allowing the usual separators.
const LONG_DIGITS = /(?:\+?\d[\s-]?){8,}\d/g;
// Long random-looking tokens (presigned URLs, session ids, hashes).
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const QUERY = /\?[^\s#'")]*/g;

/** Removes personal data and secrets from free text. */
export function scrubText(value, max) {
  if (typeof value !== 'string') return '';
  let s = value.slice(0, max * 2);
  s = s.replace(EMAIL, '[email]')
    .replace(JWT, '[token]')
    .replace(BEARER, '$1 [token]')
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(QUERY, '?[query]')
    .replace(LONG_TOKEN, '[token]')
    .replace(LONG_DIGITS, '[number]');
  // Control characters out (log injection, broken JSON in the panel).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return s.slice(0, max).trim();
}

/** The path of a URL (no host, no query, no hash), scrubbed. '' when it is not a URL. */
export function cleanPath(value) {
  if (typeof value !== 'string' || !value) return '';
  let path;
  try {
    path = new URL(value, 'https://placeholder.invalid').pathname;
  } catch {
    return '';
  }
  return scrubText(path, L.url);
}

/** Pages that only staff use. Errors there are not customer-facing, so they are not recorded. */
const STAFF_PREFIXES = ['/admin', '/team', '/staff-invite', '/dev', '/partner'];
export const isStaffPath = (path) =>
  STAFF_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

const BOT_UA = /bot\b|bot\/|crawler|spider|slurp|crawl|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget\/|python-requests|python-urllib|axios\/|node-fetch|go-http-client|java\/|okhttp|httpclient|facebookexternalhit|whatsapp|preview|phantomjs|selenium|puppeteer|playwright/i;
/** Bots, uptime checks and scripts. An empty user agent counts as a bot. */
export const isBot = (ua) => !ua || BOT_UA.test(ua);

/** Browser, OS and device class from a user agent. Coarse on purpose: enough to reproduce, nothing more. */
export function parseUserAgent(ua = '') {
  const s = String(ua).slice(0, 400);
  const pick = (re) => { const m = re.exec(s); return m ? m[1] : ''; };
  let browser = 'Other';
  if (/SamsungBrowser\/(\d+)/.test(s)) browser = `Samsung Internet ${pick(/SamsungBrowser\/(\d+)/)}`;
  else if (/EdgA?\/(\d+)/.test(s)) browser = `Edge ${pick(/EdgA?\/(\d+)/)}`;
  else if (/OPR\/(\d+)/.test(s)) browser = `Opera ${pick(/OPR\/(\d+)/)}`;
  else if (/FBAN|FBAV|Instagram/.test(s)) browser = /Instagram/.test(s) ? 'Instagram in-app' : 'Facebook in-app';
  else if (/Firefox\/(\d+)/.test(s)) browser = `Firefox ${pick(/Firefox\/(\d+)/)}`;
  else if (/CriOS\/(\d+)/.test(s)) browser = `Chrome ${pick(/CriOS\/(\d+)/)} (iOS)`;
  else if (/Chrome\/(\d+)/.test(s)) browser = `Chrome ${pick(/Chrome\/(\d+)/)}`;
  else if (/Version\/(\d+).*Safari/.test(s)) browser = `Safari ${pick(/Version\/(\d+)/)}`;

  let os = 'Other';
  if (/Android (\d+)/.test(s)) os = `Android ${pick(/Android (\d+)/)}`;
  else if (/(?:iPhone|iPad|iPod).*OS (\d+)/.test(s)) os = `iOS ${pick(/OS (\d+)/)}`;
  else if (/Windows NT 10/.test(s)) os = 'Windows 10/11';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X (\d+)/.test(s)) os = `macOS ${pick(/Mac OS X (\d+)/)}`;
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let device = 'desktop';
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(s)) device = 'mobile';
  if (!s) device = 'unknown';
  return { browser, os, device };
}

// Context keys that might carry a person or a secret: never stored, whatever the value.
const BLOCKED_CONTEXT_KEY = /name|email|phone|mobile|contact|address|pass|secret|token|key|sig|otp|card|cvv|upi|vpa|gstin|file|cookie|auth|session/i;

/** A small flat map of strings: HTTP status, gateway error code, upload slot. */
export function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= L.contextKeys) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) || BLOCKED_CONTEXT_KEY.test(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const text = scrubText(String(v), L.contextValue);
      if (text) out[k] = text;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** A stack trace, scrubbed and capped. Only the frames, never a variable dump. */
export const cleanStack = (value) => scrubText(value, L.stack);

/**
 * The part of a message that identifies the error, with what varies per occurrence
 * (numbers, ids, quoted values) taken out — so "Order 123 failed" and "Order 456
 * failed" are one error, not two.
 */
export function normaliseMessage(message) {
  return String(message)
    .toLowerCase()
    .replace(/\[(?:email|token|number|query|redacted)\]/g, '')
    .replace(/["'`][^"'`]{0,80}["'`]/g, '"…"')
    .replace(/\b[0-9a-f]{24}\b/g, '<id>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * The first stack frame that is our code, without the parts a new deploy changes
 * (chunk hashes, line and column numbers). Two releases throwing the same error from
 * the same function stay one record.
 */
export function topFrame(stack) {
  const lines = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => /^at |@/.test(l));
  const frame = lines.find((l) => /_next|webpack|src\//.test(l)) || lines[0] || '';
  return frame
    .replace(/https?:\/\/[^/\s)]+/g, '')
    .replace(/[.-][0-9a-f]{6,}(?=\.js)/gi, '')
    .replace(/:\d+(:\d+)?/g, '')
    .slice(0, 200);
}

export function signatureOf({ feature, step, name, message, stack }) {
  const parts = [feature, step, name, normaliseMessage(message), topFrame(stack)].join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 40);
}

const idOrNull = (v) => (typeof v === 'string' && mongoose.isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v) ? v : null);

/**
 * Validates and cleans one report. Returns { ok: true, report } or { ok: false, reason }.
 * `reason` is for logs only — the endpoint answers 204 either way so a probe learns nothing.
 */
export function cleanReport(body, { userAgent } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'not an object' };
  let size;
  try { size = Buffer.byteLength(JSON.stringify(body)); } catch { return { ok: false, reason: 'unserialisable' }; }
  if (size > L.maxPayloadBytes) return { ok: false, reason: 'too large' };

  const feature = typeof body.feature === 'string' ? body.feature : '';
  if (!CLIENT_ERROR_FEATURE_VALUES.includes(feature)) return { ok: false, reason: 'unknown feature' };

  const message = scrubText(body.message, L.message);
  if (!message) return { ok: false, reason: 'no message' };

  const path = cleanPath(body.url);
  if (!path) return { ok: false, reason: 'no url' };
  if (isStaffPath(path)) return { ok: false, reason: 'staff page' };

  const step = scrubText(body.step, L.step).replace(/[^A-Za-z0-9 _.:/-]/g, '');
  const name = scrubText(body.name, L.name).replace(/[^A-Za-z0-9_.:$-]/g, '') || 'Error';
  const stack = cleanStack(body.stack);
  const level = CLIENT_ERROR_LEVELS.includes(body.level) ? body.level : 'error';
  const release = typeof body.release === 'string' ? body.release.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) : '';

  return {
    ok: true,
    report: {
      feature,
      step,
      level,
      name,
      message,
      stack,
      path,
      release,
      orderId: idOrNull(body.orderId),
      context: cleanContext(body.context),
      ...parseUserAgent(userAgent),
      signature: signatureOf({ feature, step, name, message, stack }),
    },
  };
}
