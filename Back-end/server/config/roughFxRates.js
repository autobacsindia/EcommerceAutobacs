/**
 * Rough rupees for one unit of each currency on the expense list
 * (config/expenseCategories.js EXPENSE_CURRENCIES) — Nov 2026.
 *
 * For a LABEL only: "USD 20 (about ₹1,760)" on Subscriptions & dues, so a
 * team sees roughly what a bill costs. Never stored, never totalled, never
 * charged: what was actually paid is what the bank debited. Out of date by a
 * few percent is fine; a currency missing here simply shows no rupee label.
 */
export const ROUGH_INR_PER_UNIT = Object.freeze({
  USD: 88,
  EUR: 102,
  GBP: 117,
  JPY: 0.58,
  CNY: 12.4,
  THB: 2.7,
  AED: 24,
  SGD: 68,
  HKD: 11.3,
  MYR: 21,
  KRW: 0.062,
  TWD: 2.9,
});

/** About how many rupees `amount` of `currency` is, rounded to ₹10 — or null when there is no rough rate. */
export function roughInr(amount, currency) {
  const rate = ROUGH_INR_PER_UNIT[currency];
  const n = Number(amount);
  if (!rate || !Number.isFinite(n)) return null;
  return Math.round((n * rate) / 10) * 10;
}
