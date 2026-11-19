/**
 * "Save ₹250" sale badges — the rupee amount a shopper saves against the M.R.P.
 *
 * The business asked for this in place of "5% off": a small percentage on an
 * expensive part reads as nothing, while the rupee figure is what the shopper
 * actually keeps. Display only — both inputs are the server-sent prices the
 * component already renders; nothing here feeds the cart, totals or checkout.
 */

/**
 * Whole rupees saved (M.R.P. minus selling price), or 0 when there is no real
 * saving: no M.R.P., M.R.P. at or below the price, bad numbers, or under ₹1.
 * Worked in paise so ₹4,999.90 − ₹4,749.90 is exactly 250, not 249.99999.
 */
export function savingsAmount(price: number | null | undefined, mrp: number | null | undefined): number {
  const p = Number(price);
  const m = Number(mrp);
  if (!Number.isFinite(p) || !Number.isFinite(m) || p < 0 || m <= p) return 0;
  const rupees = Math.floor((Math.round(m * 100) - Math.round(p * 100)) / 100);
  return rupees >= 1 ? rupees : 0;
}

/**
 * Badge text — "Save ₹1,250" — or null when there is nothing to show, so callers
 * can write `{label && <Badge>{label}</Badge>}`. `format` is the page's own price
 * formatter (CurrencyContext), so the saving is in the same currency as the price.
 */
export function savingsLabel(
  price: number | null | undefined,
  mrp: number | null | undefined,
  format: (amount: number) => string,
): string | null {
  const amount = savingsAmount(price, mrp);
  return amount > 0 ? `Save ${format(amount)}` : null;
}
