import { formatRupees } from './formatRupees';

describe('formatRupees', () => {
  it('groups in the Indian style', () => {
    expect(formatRupees(47800)).toBe('₹47,800');
    expect(formatRupees(193500)).toBe('₹1,93,500');
    expect(formatRupees(3538215)).toBe('₹35,38,215');
  });
  it('shows paise only when exact and present', () => {
    expect(formatRupees(1234.5, { exact: true })).toBe('₹1,234.50');
    expect(formatRupees(1234, { exact: true })).toBe('₹1,234');
    expect(formatRupees(1234.5)).toBe('₹1,235');
  });
  it('never prints NaN for missing values', () => {
    expect(formatRupees(undefined)).toBe('₹0');
    expect(formatRupees(null, { exact: true })).toBe('₹0');
    expect(formatRupees(Number.NaN)).toBe('₹0');
  });
  it('handles negatives (refund adjustments)', () => {
    expect(formatRupees(-250.75, { exact: true })).toBe('-₹250.75');
  });
});
