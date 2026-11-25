import { istDayPlus, windowDates, windowDays, GENERAL_DELIVERY_COPY } from './deliveryWindow';

// Wed 25 Nov 2026, 10:00 IST
const WED = Date.parse('2026-11-25T04:30:00Z');

describe('deliveryWindow formatting', () => {
  it('day counts', () => {
    expect(windowDays({ minDays: 7, maxDays: 10 })).toBe('7–10 days');
    expect(windowDays({ minDays: 10, maxDays: 10 })).toBe('10 days');
  });

  it('dates count from the India day, and skip a Sunday (never earlier than promised)', () => {
    // +7 → Wed 2 Dec; +10 → Sat 5 Dec
    expect(windowDates({ minDays: 7, maxDays: 10 }, WED)).toBe('Wed 2 Dec – Sat 5 Dec');
    // +11 lands on Sun 6 Dec → Mon 7 Dec
    expect(istDayPlus(WED, 11).toISOString().slice(0, 10)).toBe('2026-12-07');
  });

  it('late evening UTC that is already the next day in India uses the India day', () => {
    const lateIst = Date.parse('2026-11-25T19:00:00Z'); // Thu 26 Nov 00:30 IST
    expect(istDayPlus(lateIst, 0).toISOString().slice(0, 10)).toBe('2026-11-26');
  });

  it('heavy window reads as dates too', () => {
    expect(windowDates({ minDays: 10, maxDays: 15 }, WED)).toBe('Sat 5 Dec – Thu 10 Dec');
  });

  it('general copy carries the campaign numbers', () => {
    expect(GENERAL_DELIVERY_COPY).toBe('Usually delivered in 7–10 days, up to 15 days for heavy goods');
  });
});
