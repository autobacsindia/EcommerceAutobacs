/**
 * lib/datetime.ts — IST-pinned formatting for order and lead surfaces.
 *
 * Two regressions are guarded here:
 *  1. Host-timezone leakage. `toLocaleDateString('en-IN')` sets the locale but
 *     not the zone, so SSR (UTC on Vercel) and a viewer abroad both showed the
 *     wrong Indian calendar day. Every fixture below is an instant that falls on
 *     a different date in UTC than in IST.
 *  2. Locale leakage. A bare `toLocaleDateString()` rendered "7/31/2026" on an
 *     en-US machine and "31/7/2026" on en-IN — the lead screens had exactly this.
 *
 * Because output depends on neither, these strings are also hydration-safe.
 */

import {
  toDate,
  toIsoAttr,
  formatDateIST,
  formatLongDateIST,
  formatTimeIST,
  formatDateTimeIST,
  formatLongDateTimeIST,
  formatIsoDateIST,
  formatIsoDateTimeIST,
} from './datetime';

// 31 Jul 2026 20:30 UTC === 1 Aug 2026 02:00 IST. Different day in each zone.
const CROSSOVER = '2026-07-31T20:30:00.000Z';

describe('lib/datetime — IST pinning', () => {
  it('renders the IST calendar day, not the UTC one', () => {
    expect(formatDateIST(CROSSOVER)).toBe('1 Aug 2026');
    expect(formatLongDateIST(CROSSOVER)).toBe('1 August 2026');
    expect(formatIsoDateIST(CROSSOVER)).toBe('2026-08-01');
  });

  it('renders the IST wall clock and labels the zone', () => {
    expect(formatTimeIST(CROSSOVER)).toBe('2:00 am');
    expect(formatDateTimeIST(CROSSOVER)).toBe('1 Aug 2026, 2:00 am IST');
    expect(formatLongDateTimeIST(CROSSOVER)).toBe('1 August 2026, 2:00 am IST');
  });

  it('is independent of the host timezone', () => {
    const original = process.env.TZ;
    const outputs = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland'].map((tz) => {
      process.env.TZ = tz;
      return formatLongDateTimeIST(CROSSOVER);
    });
    process.env.TZ = original;

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe('1 August 2026, 2:00 am IST');
  });

  it('uses day-first Indian ordering regardless of the runtime locale', () => {
    // The failure mode on the lead screens: US month-first ordering.
    expect(formatDateIST(CROSSOVER)).not.toMatch(/^Aug/);
    expect(formatIsoDateIST(CROSSOVER)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts Date, ISO string and epoch millis alike', () => {
    const ms = Date.parse(CROSSOVER);
    expect(formatDateIST(new Date(ms))).toBe('1 Aug 2026');
    // The lead journey timeline passes epoch millis.
    expect(formatDateIST(ms)).toBe('1 Aug 2026');
  });

  it('never emits "Invalid Date" for missing or junk input', () => {
    for (const bad of [undefined, null, '', 'not-a-date', NaN]) {
      expect(formatDateIST(bad)).toBe('—');
      expect(formatDateTimeIST(bad)).toBe('—');
      expect(formatLongDateTimeIST(bad)).toBe('—');
      expect(formatIsoDateIST(bad)).toBe('');
      expect(toIsoAttr(bad)).toBeUndefined();
    }
  });

  it('honours a caller-supplied fallback', () => {
    expect(formatLongDateIST(null, 'Typically delivered in 5–7 business days')).toBe(
      'Typically delivered in 5–7 business days'
    );
    expect(formatTimeIST(undefined, '')).toBe('');
  });

  it('produces a CSV timestamp that is sortable and comma-free', () => {
    const cell = formatIsoDateTimeIST(CROSSOVER);
    expect(cell).toBe('2026-08-01 02:00');
    // A comma here would silently shift every later column in the unquoted CSV.
    expect(cell).not.toContain(',');
    // Lexicographic order must match chronological order.
    expect(formatIsoDateTimeIST('2026-07-31T18:29:00.000Z') < cell).toBe(true);
  });

  it('keeps the IST midnight boundary on the right day', () => {
    // 18:29 UTC = 23:59 IST (same day); 18:30 UTC = 00:00 IST (next day).
    expect(formatIsoDateIST('2026-07-31T18:29:00.000Z')).toBe('2026-07-31');
    expect(formatIsoDateIST('2026-07-31T18:30:00.000Z')).toBe('2026-08-01');
    expect(formatIsoDateTimeIST('2026-07-31T18:30:00.000Z')).toBe('2026-08-01 00:00');
  });

  it('keeps the <time dateTime> attribute as the absolute UTC instant', () => {
    // Visible text is IST; the machine-readable attribute stays unambiguous.
    expect(toIsoAttr(CROSSOVER)).toBe(CROSSOVER);
  });

  it('toDate normalises to a valid Date or null', () => {
    expect(toDate(CROSSOVER)).toBeInstanceOf(Date);
    expect(toDate('garbage')).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });
});
