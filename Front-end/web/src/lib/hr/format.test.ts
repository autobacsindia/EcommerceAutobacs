import { currentMonthIST, dayLabel, halfDaysLabel, halfDaysNumber, leaveWhen, monthLabel, paise, shiftMonth } from './format';

describe('HR display helpers', () => {
  it('shows server paise as rupees without doing any pay maths', () => {
    expect(paise(2784000)).toBe('₹27,840');
    expect(paise(2784050)).toBe('₹27,840.50');
    expect(paise(null)).toBe('₹0');
  });

  it('shows half-days as days', () => {
    expect(halfDaysLabel(1)).toBe('½ day');
    expect(halfDaysLabel(2)).toBe('1 day');
    expect(halfDaysLabel(9)).toBe('4.5 days');
    expect(halfDaysNumber(9)).toBe('4.5');
    expect(halfDaysNumber(12)).toBe('6');
  });

  it('never shifts an IST calendar day', () => {
    expect(dayLabel('2026-12-04')).toMatch(/4 Dec/);
    expect(dayLabel('nope')).toBe('—');
    expect(leaveWhen({ from: '2026-12-01', to: '2026-12-01', firstHalfOnly: true })).toMatch(/1 Dec.*first half/);
  });

  it('handles months and the IST month boundary', () => {
    expect(monthLabel('2026-11')).toMatch(/November 2026/);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    // 20:00 UTC on 30 Nov is already 1 Dec in India.
    expect(currentMonthIST(new Date('2026-11-30T20:00:00Z'))).toBe('2026-12');
  });
});
