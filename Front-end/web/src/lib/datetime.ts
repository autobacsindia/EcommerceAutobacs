/**
 * Date/time formatting — single source of truth, pinned to India Standard Time.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two independent bugs were showing wrong dates on the order and lead screens:
 *
 * 1. **Timezone.** `toLocaleDateString('en-IN')` selects the *locale*, not the
 *    *timezone* — it still renders in whatever zone the runtime is in. In a
 *    client component that's the viewer's laptop; during SSR it's the server
 *    (UTC on Vercel/Railway). An order placed at 01-Aug 02:00 IST is stored as
 *    31-Jul 20:30 UTC and rendered as "31 July 2026" by anything not in IST.
 *    Ops, invoices and the customer must all see the same Indian calendar day.
 *
 * 2. **Bare `toLocaleDateString()`** (no locale at all, as the lead screens had)
 *    is machine-dependent: "7/31/2026" on an en-US browser, "31/7/2026" on
 *    en-IN. Ambiguous to read and inconsistent with the order screens.
 *
 * Fixing both at the call site is whack-a-mole, so every human-facing timestamp
 * goes through here. Timestamps stay UTC in Mongo and on the wire; this module
 * is purely the presentation edge.
 *
 * Bonus: because output no longer depends on the runtime's zone or locale, these
 * are hydration-safe — server and client render byte-identical strings.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';

/** Shown when a timestamp is absent or unparseable — never render "Invalid Date". */
export const EMPTY_DATE = '—';

export type DateInput = string | number | Date | null | undefined;

/**
 * Coerce anything date-ish to a valid Date, or null.
 * Single choke point for the "Invalid Date" class of bug: `new Date(undefined)`,
 * `new Date('')` and `new Date('garbage')` all collapse to null here.
 */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `Intl.DateTimeFormat` construction is comparatively expensive and these run
 * once per row in admin tables (orders, leads — 50-100 rows a page, re-rendered
 * on every filter keystroke), so formatters are memoised by option signature.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

function format(value: DateInput, options: Intl.DateTimeFormatOptions, fallback: string): string {
  const d = toDate(value);
  if (!d) return fallback;
  // en-IN emits a narrow/non-breaking space before "am"/"pm"; normalise to a
  // plain space so copy-paste, CSV cells and string comparisons behave.
  return formatter(options).format(d).replace(/[\u202f\u00a0]/g, ' ');
}

/** "1 Aug 2026" — compact date for table cells and list rows. */
export const formatDateIST = (value: DateInput, fallback = EMPTY_DATE): string =>
  format(value, { day: 'numeric', month: 'short', year: 'numeric' }, fallback);

/** "1 August 2026" — long date for detail panes and headings. */
export const formatLongDateIST = (value: DateInput, fallback = EMPTY_DATE): string =>
  format(value, { day: 'numeric', month: 'long', year: 'numeric' }, fallback);

/** "2:00 am" — time of day, for the secondary line under a date in a table. */
export const formatTimeIST = (value: DateInput, fallback = EMPTY_DATE): string =>
  format(value, { hour: 'numeric', minute: '2-digit', hour12: true }, fallback);

/**
 * Join a date and a time part with an explicit separator.
 *
 * Deliberately NOT a single `Intl` call with both date and time fields: ICU
 * picks its own connector for that combination (", " for a short month, " at "
 * for a long one) and the choice varies by ICU version. Node and the browser
 * can ship different ICU builds, which would make server- and client-rendered
 * markup differ — a hydration mismatch, and the exact class of runtime
 * dependence this module exists to remove. Composing keeps output byte-stable.
 */
function joinDateTime(datePart: string, timePart: string): string {
  return `${datePart}, ${timePart} IST`;
}

/**
 * "1 Aug 2026, 2:00 am IST" — for anything where the clock matters.
 * The "IST" suffix is deliberate: the value is pinned to Indian time regardless
 * of where it's read, so leaving the zone to inference would be its own bug.
 */
export function formatDateTimeIST(value: DateInput, fallback = EMPTY_DATE): string {
  const d = toDate(value);
  if (!d) return fallback;
  return joinDateTime(formatDateIST(d), formatTimeIST(d));
}

/** "1 August 2026, 2:00 am IST" — long-form variant for detail headers. */
export function formatLongDateTimeIST(value: DateInput, fallback = EMPTY_DATE): string {
  const d = toDate(value);
  if (!d) return fallback;
  return joinDateTime(formatLongDateIST(d), formatTimeIST(d));
}

/**
 * "2026-08-01" — the IST calendar day, ISO-shaped, for filenames and CSV columns
 * that must sort lexicographically and parse unambiguously in Excel.
 * NOT `toISOString().slice(0,10)`, which gives the UTC day and is off by one for
 * anything between 00:00 and 05:30 IST.
 */
export function formatIsoDateIST(value: DateInput, fallback = ''): string {
  const d = toDate(value);
  if (!d) return fallback;
  // en-CA yields ISO-ordered Y-M-D; the timeZone is the part that matters.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** "2026-08-01 02:00" — sortable IST timestamp for CSV exports. */
export function formatIsoDateTimeIST(value: DateInput, fallback = ''): string {
  const d = toDate(value);
  if (!d) return fallback;
  const time = format(d, { hour: '2-digit', minute: '2-digit', hour12: false }, '');
  // en-IN renders midnight as "24:00" in h23-adjacent configurations; normalise.
  return `${formatIsoDateIST(d)} ${time.replace(/^24:/, '00:')}`;
}

/**
 * Machine-readable UTC instant for a `<time dateTime="...">` attribute.
 * The visible text is IST; the attribute stays the unambiguous absolute instant.
 */
export function toIsoAttr(value: DateInput): string | undefined {
  return toDate(value)?.toISOString();
}
