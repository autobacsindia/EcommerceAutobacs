/**
 * utils/datetime.js — IST-pinned formatting.
 *
 * The bug these guard against: Railway containers run in UTC, so an order placed
 * just after midnight IST was rendering on the *previous* calendar day (and with
 * a clock 5h30m behind) on invoices and notification emails. Every assertion here
 * uses a UTC instant that falls on a different date in UTC than in IST, so any
 * regression to host-timezone formatting fails the test rather than silently
 * shipping wrong dates on a tax document.
 */

import {
  toDate,
  formatDateIST,
  formatLongDateIST,
  formatTimeIST,
  formatDateTimeIST,
  formatIsoDateIST,
} from '../../../utils/datetime.js';

// 31 Jul 2026 20:30 UTC === 1 Aug 2026 02:00 IST. Different day in each zone.
const CROSSOVER = '2026-07-31T20:30:00.000Z';

describe('utils/datetime — IST pinning', () => {
  it('renders the IST calendar day, not the UTC one', () => {
    expect(formatDateIST(CROSSOVER)).toBe('1 Aug 2026');
    expect(formatLongDateIST(CROSSOVER)).toBe('1 August 2026');
    expect(formatIsoDateIST(CROSSOVER)).toBe('2026-08-01');
  });

  it('renders the IST wall clock and labels the zone', () => {
    expect(formatTimeIST(CROSSOVER)).toBe('2:00 am');
    expect(formatDateTimeIST(CROSSOVER)).toBe('1 Aug 2026, 2:00 am IST');
  });

  it('is independent of the host timezone', () => {
    const original = process.env.TZ;
    const outputs = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland'].map((tz) => {
      process.env.TZ = tz;
      return formatDateTimeIST(CROSSOVER);
    });
    process.env.TZ = original;

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe('1 Aug 2026, 2:00 am IST');
  });

  it('accepts Date, ISO string and epoch millis alike', () => {
    const ms = Date.parse(CROSSOVER);
    expect(formatDateIST(new Date(ms))).toBe('1 Aug 2026');
    expect(formatDateIST(ms)).toBe('1 Aug 2026');
    expect(formatDateIST(CROSSOVER)).toBe('1 Aug 2026');
  });

  it('never emits "Invalid Date" for missing or junk input', () => {
    for (const bad of [undefined, null, '', 'not-a-date', NaN]) {
      expect(formatDateIST(bad)).toBe('—');
      expect(formatDateTimeIST(bad)).toBe('—');
      expect(formatLongDateIST(bad)).toBe('—');
      expect(formatIsoDateIST(bad)).toBe('');
    }
  });

  it('honours a caller-supplied fallback', () => {
    expect(formatDateIST(null, 'Not scheduled')).toBe('Not scheduled');
    expect(formatLongDateIST(undefined, 'TBD')).toBe('TBD');
  });

  it('toDate normalises to a valid Date or null', () => {
    expect(toDate(CROSSOVER)).toBeInstanceOf(Date);
    expect(toDate('garbage')).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });

  it('uses plain ASCII spaces so PDF and plain-text email render cleanly', () => {
    // Intl emits U+202F/U+00A0 around the am/pm marker; pdfkit's WinAnsi
    // fallback and some mail clients mangle those.
    expect(formatDateTimeIST(CROSSOVER)).not.toMatch(/[\u202f\u00a0]/);
    expect(formatTimeIST(CROSSOVER)).not.toMatch(/[\u202f\u00a0]/);
  });

  it('keeps midday/midnight boundaries on the right IST day', () => {
    // 18:29 UTC = 23:59 IST (same day); 18:30 UTC = 00:00 IST (next day).
    expect(formatIsoDateIST('2026-07-31T18:29:00.000Z')).toBe('2026-07-31');
    expect(formatIsoDateIST('2026-07-31T18:30:00.000Z')).toBe('2026-08-01');
  });
});
