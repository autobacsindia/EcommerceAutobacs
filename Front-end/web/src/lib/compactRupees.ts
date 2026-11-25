/**
 * Indian short money: ₹1.40 Cr, ₹61.9 L, ₹45,000. Rounds DOWN, so a short
 * figure never shows more than the real one (₹99.96 L stays "₹99.9 L", never "₹1 Cr").
 */
const full = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const floorTo = (n: number, digits: number) => Math.floor(n * 10 ** digits) / 10 ** digits;
const trim = (n: number, digits: number) => floorTo(n, digits).toFixed(digits).replace(/\.?0+$/, '');

export function compactRupees(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '−' : '';
  const a = Math.abs(amount);
  // Crores keep both decimals (₹1.40 Cr) so a figure always reads to the lakh.
  if (a >= 1e7) return `${sign}₹${floorTo(a / 1e7, 2).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5, 1)} L`;
  return `${sign}${full.format(Math.floor(a))}`;
}
