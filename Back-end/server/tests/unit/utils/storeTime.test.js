/**
 * Store-timezone boundary maths.
 *
 * These are the cases that break silently on a UTC server: the last 5½ hours of
 * 31 March IST are already 1 April UTC, so a naive boundary files an evening
 * order under the wrong financial year and quietly moves money between periods.
 */

import { currentFiscalYear, storeDateString, STORE_TZ_OFFSET } from '../../../utils/storeTime.js';

describe('storeTime', () => {
  it('defaults to IST', () => {
    expect(STORE_TZ_OFFSET).toBe('+05:30');
  });

  describe('currentFiscalYear', () => {
    it('runs 1 April → 31 March', () => {
      // 4 Aug 2026 IST → FY 26-27, which began 1 Apr 2026.
      const fy = currentFiscalYear(new Date('2026-08-04T06:41:00.000Z'));

      expect(fy.label).toBe('FY 26-27');
      expect(fy.startDate).toBe('2026-04-01');
      // 1 Apr 00:00 IST is 31 Mar 18:30 UTC.
      expect(fy.start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    });

    it('puts January in the financial year that started the previous April', () => {
      const fy = currentFiscalYear(new Date('2027-01-15T12:00:00.000Z'));

      expect(fy.label).toBe('FY 26-27');
      expect(fy.startDate).toBe('2026-04-01');
    });

    it('does not roll over early: 31 March 23:00 IST is still the old FY', () => {
      // 31 Mar 23:00 IST === 31 Mar 17:30 UTC. A UTC-naive implementation that
      // read the UTC month would agree here; the next case is the one that bites.
      const fy = currentFiscalYear(new Date('2027-03-31T17:30:00.000Z'));

      expect(fy.label).toBe('FY 26-27');
    });

    it('rolls over on time: 1 April 00:30 IST is the new FY even though it is still March in UTC', () => {
      // 1 Apr 00:30 IST === 31 Mar 19:00 UTC.
      const instant = new Date('2027-03-31T19:00:00.000Z');
      expect(instant.getUTCMonth()).toBe(2); // still March in UTC — the trap

      const fy = currentFiscalYear(instant);

      expect(fy.label).toBe('FY 27-28');
      expect(fy.startDate).toBe('2027-04-01');
    });

    it('starts exactly at its own boundary (start instant belongs to the FY it opens)', () => {
      const fy = currentFiscalYear(new Date('2026-08-04T06:41:00.000Z'));

      expect(currentFiscalYear(fy.start).label).toBe(fy.label);
      // One millisecond earlier is the previous FY — the $gte in the revenue
      // aggregate depends on this being a half-open boundary.
      expect(currentFiscalYear(new Date(fy.start.getTime() - 1)).label).toBe('FY 25-26');
    });
  });

  describe('storeDateString', () => {
    it('reports the store-local calendar day, not the UTC one', () => {
      // 31 Jul 2026 20:00 UTC === 1 Aug 2026 01:30 IST.
      expect(storeDateString(new Date('2026-07-31T20:00:00.000Z'))).toBe('2026-08-01');
    });

    it('zero-pads month and day', () => {
      expect(storeDateString(new Date('2026-04-01T00:00:00.000Z'))).toBe('2026-04-01');
    });
  });
});
