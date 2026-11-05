/**
 * Indian-rupee display formatting — "₹47,800", or "₹47,800.50" when paise matter.
 *
 * Display only: every amount shown here was computed by the server. This exists
 * because checkout, the order pages and a few modals printed `₹${n.toFixed(2)}`,
 * which reads "₹47800.00" — no lakh/thousand grouping, unlike the cart and PDP.
 *
 * @param amount  rupees (not paise)
 * @param exact   show paise when the value has them (totals, tax, refunds); without
 *                it a figure is rounded to whole rupees (catalogue prices)
 */
export function formatRupees(amount: number | null | undefined, { exact = false }: { exact?: boolean } = {}): string {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  const digits = exact && hasPaise ? 2 : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
