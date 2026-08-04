/**
 * Business-hours SLA arithmetic.
 *
 * These deadlines decide when someone gets paged, so the edge cases that matter
 * are the boundaries: overnight rollover, the Sunday closure, holidays, and
 * out-of-hours arrivals that must NOT be born already breached.
 *
 * Fixtures use explicit +05:30 offsets so the assertions hold regardless of the
 * TZ the test runner happens to have — which is the exact class of bug this
 * module exists to prevent.
 */

import {
  addBusinessHours,
  addBusinessMinutes,
  businessMinutesBetween,
  isWithinBusinessHours,
} from '../../../utils/businessHours.js';

/** Build an instant from an IST wall-clock string. */
const IST = (s) => new Date(`${s}+05:30`);

/** Render an instant back to IST "YYYY-MM-DD HH:mm" for readable assertions. */
const istString = (d) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};

// 2026-08-03 is a Monday; 2026-08-08 a Saturday; 2026-08-09 a Sunday.
describe('businessHours — isWithinBusinessHours', () => {
  it('accepts a weekday inside 10:00–18:00 IST', () => {
    expect(isWithinBusinessHours(IST('2026-08-03T12:00:00'))).toBe(true);
  });

  it('rejects before opening and at/after closing', () => {
    expect(isWithinBusinessHours(IST('2026-08-03T09:59:00'))).toBe(false);
    expect(isWithinBusinessHours(IST('2026-08-03T18:00:00'))).toBe(false);
  });

  it('rejects Sunday', () => {
    expect(isWithinBusinessHours(IST('2026-08-09T12:00:00'))).toBe(false);
  });

  it('accepts Saturday, which is a working day here', () => {
    expect(isWithinBusinessHours(IST('2026-08-08T12:00:00'))).toBe(true);
  });

  it('rejects a configured holiday', () => {
    expect(isWithinBusinessHours(IST('2026-08-03T12:00:00'), ['2026-08-03'])).toBe(false);
  });

  it('returns false for an unparseable value rather than throwing', () => {
    expect(isWithinBusinessHours('not a date')).toBe(false);
  });
});

describe('businessHours — addBusinessHours', () => {
  it('adds within a single working day', () => {
    expect(istString(addBusinessHours(IST('2026-08-03T11:00:00'), 4)))
      .toBe('2026-08-03 15:00');
  });

  it('rolls over the overnight gap without counting it', () => {
    // 16:00 + 4h = 2h before close, then 2h from 10:00 the next morning.
    expect(istString(addBusinessHours(IST('2026-08-03T16:00:00'), 4)))
      .toBe('2026-08-04 12:00');
  });

  it('skips Sunday entirely', () => {
    expect(istString(addBusinessHours(IST('2026-08-08T17:00:00'), 4)))
      .toBe('2026-08-10 13:00');
  });

  it('does not start the clock until opening for an out-of-hours arrival', () => {
    // A 03:00 email must not consume the SLA before anyone could have read it.
    expect(istString(addBusinessHours(IST('2026-08-03T03:00:00'), 2)))
      .toBe('2026-08-03 12:00');
  });

  it('starts a Sunday arrival on Monday morning', () => {
    expect(istString(addBusinessHours(IST('2026-08-09T12:00:00'), 2)))
      .toBe('2026-08-10 12:00');
  });

  it('spans multiple days for a long SLA', () => {
    // Fri 17:00: 1h Fri + 8h Sat + (Sun closed) + 8h Mon + 7h Tue.
    expect(istString(addBusinessHours(IST('2026-08-07T17:00:00'), 24)))
      .toBe('2026-08-11 17:00');
  });

  it('treats exactly one working day as ending at close of business', () => {
    expect(istString(addBusinessHours(IST('2026-08-03T10:00:00'), 8)))
      .toBe('2026-08-03 18:00');
  });

  it('skips a configured holiday', () => {
    expect(istString(addBusinessHours(IST('2026-08-03T16:00:00'), 4, ['2026-08-04'])))
      .toBe('2026-08-05 12:00');
  });

  it('snaps a zero-duration SLA to opening rather than breaching instantly', () => {
    expect(istString(addBusinessHours(IST('2026-08-09T12:00:00'), 0)))
      .toBe('2026-08-10 10:00');
  });

  it('supports fractional hours', () => {
    expect(istString(addBusinessHours(IST('2026-08-03T11:00:00'), 0.5)))
      .toBe('2026-08-03 11:30');
  });

  it('throws on an invalid start date', () => {
    expect(() => addBusinessMinutes('nonsense', 60)).toThrow(TypeError);
  });
});

describe('businessHours — businessMinutesBetween', () => {
  it('excludes the overnight gap', () => {
    expect(businessMinutesBetween(
      IST('2026-08-03T16:00:00'),
      IST('2026-08-04T12:00:00')
    )).toBe(240); // 2h Mon evening + 2h Tue morning
  });

  it('excludes Sunday', () => {
    expect(businessMinutesBetween(
      IST('2026-08-08T17:00:00'),
      IST('2026-08-10T11:00:00')
    )).toBe(120); // 1h Sat + 1h Mon
  });

  it('measures a simple same-day interval', () => {
    expect(businessMinutesBetween(
      IST('2026-08-03T11:00:00'),
      IST('2026-08-03T12:30:00')
    )).toBe(90);
  });

  it('returns 0 when the end precedes the start', () => {
    expect(businessMinutesBetween(
      IST('2026-08-03T12:00:00'),
      IST('2026-08-03T11:00:00')
    )).toBe(0);
  });

  it('counts zero for an interval entirely outside business hours', () => {
    expect(businessMinutesBetween(
      IST('2026-08-09T10:00:00'),
      IST('2026-08-09T17:00:00')
    )).toBe(0);
  });

  it('round-trips against addBusinessHours', () => {
    const start = IST('2026-08-03T16:00:00');
    const due = addBusinessHours(start, 6);
    expect(businessMinutesBetween(start, due)).toBe(360);
  });
});
