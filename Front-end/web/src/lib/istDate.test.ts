import { istStartOfDayISO, istEndOfDayISO, toISTDateInput } from './istDate';

/**
 * These pin the campaign-window bug: an admin typing "ends 5 Sep" must close the offer
 * at the END of 5 September in India, not at 05:30 that morning. The naive
 * `new Date('2026-09-05').toISOString()` produces UTC midnight and loses the whole of
 * the last trading day of a festive campaign.
 */
describe('IST day boundaries', () => {
  it('opens a campaign at midnight IST, not midnight UTC', () => {
    expect(istStartOfDayISO('2026-08-15')).toBe('2026-08-14T18:30:00.000Z');
    // The naive version would have been 2026-08-15T00:00:00.000Z — 05:30 IST.
    expect(istStartOfDayISO('2026-08-15')).not.toBe(new Date('2026-08-15').toISOString());
  });

  it('closes a campaign at the last moment of the IST day', () => {
    expect(istEndOfDayISO('2026-09-05')).toBe('2026-09-05T18:29:59.999Z');
  });

  it('round-trips a date through the input without shifting the day', () => {
    // The display bug: an IST-midnight start stored as 18:30Z the previous day used to
    // read back as the previous date, so "15 Aug" appeared in the form as "14 Aug".
    const stored = istStartOfDayISO('2026-08-15')!;
    expect(toISTDateInput(stored)).toBe('2026-08-15');

    const end = istEndOfDayISO('2026-09-05')!;
    expect(toISTDateInput(end)).toBe('2026-09-05');
  });

  it('keeps the window strictly inside the intended IST days', () => {
    const start = new Date(istStartOfDayISO('2026-08-15')!).getTime();
    const end = new Date(istEndOfDayISO('2026-09-05')!).getTime();

    const at = (s: string) => new Date(s).getTime();
    expect(at('2026-08-14T23:59:00+05:30')).toBeLessThan(start);      // before opening
    expect(at('2026-08-15T00:01:00+05:30')).toBeGreaterThan(start);   // just open
    expect(at('2026-09-05T23:59:00+05:30')).toBeLessThan(end);        // last day still live
    expect(at('2026-09-06T00:30:00+05:30')).toBeGreaterThan(end);     // closed
  });

  it('returns null or empty for unparseable input rather than an invalid date', () => {
    expect(istStartOfDayISO('')).toBeNull();
    expect(istStartOfDayISO('05-09-2026')).toBeNull();
    expect(istEndOfDayISO('not-a-date')).toBeNull();
    expect(toISTDateInput(null)).toBe('');
    expect(toISTDateInput('rubbish')).toBe('');
  });
});
