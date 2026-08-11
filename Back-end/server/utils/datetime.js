/**
 * Date/time formatting — single source of truth, pinned to India Standard Time.
 *
 * WHY THIS EXISTS
 * ---------------
 * `toLocaleString('en-IN')` picks the *locale* but NOT the *timezone*: it still
 * renders in the host's zone. Railway containers run in UTC, so an order placed
 * at 01-Aug 02:00 IST (= 31-Jul 20:30 UTC) was rendering as "31/7/2026, 8:30 pm"
 * on invoices, admin alert emails and customer emails — the wrong calendar day
 * AND a clock 5h30m behind what the customer and the ops team actually saw.
 *
 * Every timestamp is stored in Mongo as UTC (correct — don't change that). This
 * module is the presentation edge: it converts UTC → IST explicitly via
 * `timeZone: 'Asia/Kolkata'`, so output is identical on a dev laptop in IST, a
 * UTC container, and a CI runner. Business hours, invoice dates and SLA clocks
 * for this company are IST; do not make the render zone depend on where the
 * process happens to run.
 *
 * Use these helpers for anything a human reads. Machine-readable payloads
 * (APIs, feeds, webhooks) must keep emitting ISO-8601 UTC.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

/** Shown when a timestamp is absent or unparseable — never render "Invalid Date". */
const EMPTY = '—';

/**
 * Coerce anything date-ish to a valid Date, or null.
 * Guards the "Invalid Date" class of bug at a single choke point: `new Date(undefined)`,
 * `new Date('')` and `new Date('not a date')` all collapse to null here.
 */
export const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * IST day boundaries for a plain `YYYY-MM-DD` string.
 *
 * The inverse of the formatting problem above, and just as costly. `new Date('2026-09-05')`
 * is parsed by spec as UTC midnight — 05:30 IST — so treating it as a campaign's end
 * instant would close the offer at half five in the morning and silently lose the whole
 * of the last day's trading. Likewise a bare start date would open the offer at 05:30
 * rather than midnight.
 *
 * IST is UTC+05:30 year-round with no daylight saving, so the offset can be stated
 * literally and the result is exact.
 *
 * Use these wherever an operator types a DATE but the system needs an INSTANT —
 * campaign windows, sale windows, report ranges.
 */
const IST_OFFSET = '+05:30';

/** 00:00:00.000 IST on the given YYYY-MM-DD. Returns null for anything unparseable. */
export const istStartOfDay = (ymd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return toDate(ymd);
  return toDate(`${ymd}T00:00:00.000${IST_OFFSET}`);
};

/** 23:59:59.999 IST on the given YYYY-MM-DD — the last instant of that IST day. */
export const istEndOfDay = (ymd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return toDate(ymd);
  return toDate(`${ymd}T23:59:59.999${IST_OFFSET}`);
};

/**
 * `Intl.DateTimeFormat` construction is comparatively expensive and these run in
 * per-order loops (invoice tables, digest emails), so formatters are memoised by
 * their option signature.
 */
const formatterCache = new Map();
const formatter = (options) => {
  const key = JSON.stringify(options);
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, ...options });
    formatterCache.set(key, f);
  }
  return f;
};

const format = (value, options, fallback = EMPTY) => {
  const d = toDate(value);
  if (!d) return fallback;
  // en-IN renders "am/pm" lowercase with a NBSP; normalise to a plain ASCII space
  // so the string is safe inside a PDF (pdfkit's WinAnsi fallback) and plain-text email.
  return formatter(options).format(d).replace(/[\u202f\u00a0]/g, ' ');
};

/** "1 Aug 2026" — compact date for tables and list rows. */
export const formatDateIST = (value, fallback = EMPTY) =>
  format(value, { day: 'numeric', month: 'short', year: 'numeric' }, fallback);

/** "1 August 2026" — long date for invoices and formal email copy. */
export const formatLongDateIST = (value, fallback = EMPTY) =>
  format(value, { day: 'numeric', month: 'long', year: 'numeric' }, fallback);

/** "7:30 am" — time of day. */
export const formatTimeIST = (value, fallback = EMPTY) =>
  format(value, { hour: 'numeric', minute: '2-digit', hour12: true }, fallback);

/**
 * "1 Aug 2026, 7:30 am IST" — the default for anything where the clock matters
 * (cancellations, status changes, audit lines). The explicit "IST" suffix is
 * deliberate: recipients may read the mail from any timezone, and the whole
 * point of this module is that the zone is never left to inference.
 */
export const formatDateTimeIST = (value, fallback = EMPTY) => {
  const d = toDate(value);
  if (!d) return fallback;
  // Composed rather than one Intl call with both date and time fields: ICU picks
  // its own connector there (", " vs " at ") and that choice shifts between ICU
  // versions, so composing keeps invoice and email output byte-stable across
  // Node upgrades and between the container and a developer's machine.
  return `${formatDateIST(d)}, ${formatTimeIST(d)} IST`;
};

/**
 * "2026-08-01" — IST calendar day as an ISO-shaped string, for filenames,
 * grouping keys and CSV columns that must sort lexicographically.
 * NOT the same as `toISOString().slice(0,10)`, which yields the UTC day and is
 * off by one for anything timestamped between 00:00 and 05:30 IST.
 */
export const formatIsoDateIST = (value, fallback = '') => {
  const d = toDate(value);
  if (!d) return fallback;
  // en-CA gives ISO-ordered Y-M-D; the timezone is what we're actually after.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};
