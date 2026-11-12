import { currentIstMonth } from './SalesRatingsMonthly';

describe('currentIstMonth', () => {
  it('uses the India date, not UTC', () => {
    expect(currentIstMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11'); // 00:30 IST, 1 Nov
    expect(currentIstMonth(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10'); // 23:30 IST, 31 Oct
  });
});
