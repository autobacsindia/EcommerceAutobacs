import { compactRupees } from './compactRupees';

it('shows crores, lakhs and plain rupees, never rounding up', () => {
  expect(compactRupees(14943696)).toBe('₹1.49 Cr');
  expect(compactRupees(10000000)).toBe('₹1.00 Cr');
  expect(compactRupees(14078723)).toBe('₹1.40 Cr');
  expect(compactRupees(9996000)).toBe('₹99.9 L');
  expect(compactRupees(6193000)).toBe('₹61.9 L');
  expect(compactRupees(45000.9)).toBe('₹45,000');
  expect(compactRupees(0)).toBe('₹0');
  expect(compactRupees(Number.NaN)).toBe('—');
});
