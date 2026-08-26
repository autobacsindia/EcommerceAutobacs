/**
 * The INR branch of `CurrencyContext.formatPrice`, for tests that mock the provider.
 *
 * Exists because the hand-written mocks did not behave like the real formatter. The
 * common one was ``(n) => `₹${n}` ``, which prints ₹29.97 verbatim — so a test could
 * assert an exact figure and pass while the application, which rounds INR to whole
 * rupees, displayed "₹30". That is the precise defect the rupee copy was meant to remove
 * (a card promising more than the cart charges), and the test suite was blind to it.
 *
 * Mirrors the real implementation rather than approximating it: same locale, same
 * `exact` rule, same "paise only when they exist" behaviour. If the real formatter
 * changes, this has to change with it — which is the point. It is deliberately NOT
 * imported from the context module, because the tests that use it are mocking that
 * module and importing from it would resolve to the mock.
 */
export function formatPriceMock(price: number, options?: { exact?: boolean }): string {
  const hasPaise = Math.round(price * 100) % 100 !== 0;
  const digits = options?.exact && hasPaise ? 2 : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(price);
}
