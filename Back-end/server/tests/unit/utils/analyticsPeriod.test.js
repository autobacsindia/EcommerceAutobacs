import { resolvePeriod, granularityForDays, MAX_RANGE_DAYS, DEFAULT_PERIOD } from '../../../utils/analyticsPeriod.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const days = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

describe('analyticsPeriod.resolvePeriod', () => {
  it('defaults to 30d when no params given', () => {
    const w = resolvePeriod({});
    expect(w.label).toBe(DEFAULT_PERIOD);
    expect(days(w.from, w.to)).toBe(30);
  });

  it('maps named periods to their span', () => {
    expect(days(...spanOf('7d'))).toBe(7);
    expect(days(...spanOf('90d'))).toBe(90);
    expect(days(...spanOf('12m'))).toBe(365);
  });

  it('builds an equal-length previous window immediately preceding the current', () => {
    const w = resolvePeriod({ period: '7d' });
    // prev window ends exactly where the current starts, same length
    expect(w.prevTo.getTime()).toBe(w.from.getTime());
    expect(days(w.prevFrom, w.prevTo)).toBe(7);
  });

  it('honours an explicit from/to range', () => {
    const w = resolvePeriod({ from: '2026-01-01', to: '2026-01-31' });
    expect(w.label).toBe('custom');
    expect(days(w.from, w.to)).toBe(30);
  });

  it('swaps reversed from/to', () => {
    const w = resolvePeriod({ from: '2026-01-31', to: '2026-01-01' });
    expect(w.from.getTime()).toBeLessThan(w.to.getTime());
  });

  it('clamps an over-long range to the maximum', () => {
    const w = resolvePeriod({ from: '2000-01-01', to: '2026-01-01' });
    expect(days(w.from, w.to)).toBeLessThanOrEqual(MAX_RANGE_DAYS + 1);
  });

  it('falls back to default on garbage dates', () => {
    const w = resolvePeriod({ from: 'not-a-date' });
    expect(w.label).toBe(DEFAULT_PERIOD);
  });

  it('never returns a zero-length window', () => {
    const w = resolvePeriod({ from: '2026-01-01', to: '2026-01-01' });
    expect(w.to.getTime()).toBeGreaterThan(w.from.getTime());
  });

  it('picks granularity by span', () => {
    expect(granularityForDays(7)).toBe('day');
    expect(granularityForDays(120)).toBe('week');
    expect(granularityForDays(300)).toBe('month');
  });
});

function spanOf(period) {
  const w = resolvePeriod({ period });
  return [w.from, w.to];
}
