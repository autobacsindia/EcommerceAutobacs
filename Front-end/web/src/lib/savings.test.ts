import { formatRupees } from './formatRupees';
import { savingsAmount, savingsLabel } from './savings';

const fmt = (n: number) => formatRupees(n);

describe('savingsAmount', () => {
  it('is M.R.P. minus price in whole rupees', () => {
    expect(savingsAmount(4750, 5000)).toBe(250);
    expect(savingsAmount(47800, 49050)).toBe(1250);
  });
  it('is exact with paise (no float drift)', () => {
    expect(savingsAmount(4749.9, 4999.9)).toBe(250);
    expect(savingsAmount(100.1, 350.3)).toBe(250);
  });
  it('rounds down, never promising more than the real saving', () => {
    expect(savingsAmount(100, 350.99)).toBe(250);
  });
  it('is 0 when there is no saving', () => {
    expect(savingsAmount(5000, 5000)).toBe(0);
    expect(savingsAmount(5000, 4000)).toBe(0); // M.R.P. below price: never negative
    expect(savingsAmount(5000, undefined)).toBe(0);
    expect(savingsAmount(5000, null)).toBe(0);
    expect(savingsAmount(undefined, 5000)).toBe(0);
    expect(savingsAmount(Number.NaN, 5000)).toBe(0);
    expect(savingsAmount(999.5, 1000)).toBe(0); // under ₹1 is not worth a badge
  });
});

describe('savingsLabel', () => {
  it('reads "Save ₹X" in Indian grouping', () => {
    expect(savingsLabel(4750, 5000, fmt)).toBe('Save ₹250');
    expect(savingsLabel(100000, 225000, fmt)).toBe('Save ₹1,25,000');
  });
  it('is null when there is nothing to show', () => {
    expect(savingsLabel(5000, 5000, fmt)).toBeNull();
    expect(savingsLabel(5000, 4000, fmt)).toBeNull();
    expect(savingsLabel(5000, undefined, fmt)).toBeNull();
  });
  it('uses the caller formatter (shopper currency)', () => {
    expect(savingsLabel(4750, 5000, (n) => `$${n / 100}`)).toBe('Save $2.5');
  });
});
