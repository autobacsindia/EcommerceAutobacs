/**
 * Money helpers.
 *
 * The catalogue stores prices as rupee floats (GST-inclusive). Discount maths on
 * floats accumulates rounding error, and the charged total must reconcile EXACTLY
 * with what Razorpay sees (paise integers). So every discount computation runs in
 * integer paise and is converted back to a 2-decimal rupee value only at the edges.
 *
 *   rupees  →  toPaise   →  (integer arithmetic)  →  fromPaise  →  rupees
 *
 * `roundRupees` is the single rounding rule used wherever a rupee value is persisted,
 * so `order.totalAmount * 100` is always an exact integer for the gateway.
 */

/** Convert a rupee amount to integer paise (banker-free half-up rounding). */
export function toPaise(rupees) {
  return Math.round((Number(rupees) || 0) * 100);
}

/** Convert integer paise back to a 2-decimal rupee number. */
export function fromPaise(paise) {
  return Math.round(Number(paise) || 0) / 100;
}

/** Round a rupee amount to 2 decimals using the same rule as the gateway path. */
export function roundRupees(rupees) {
  return fromPaise(toPaise(rupees));
}

/**
 * The "Subtotal" a summary shows, so that its rows ADD UP to the total.
 *
 * Catalogue prices are GST-inclusive, and `tax` is the GST already inside them. A
 * summary that printed the inclusive subtotal and then that GST on the next row
 * counted the GST twice: "₹1,57,300 + ₹23,995 GST = ₹1,57,300". Shown as the
 * subtotal minus the GST it contains, the rows reconcile exactly:
 *
 *   subtotalBeforeTax − discount + tax + shipping = totalAmount
 *
 * because `tax` is the SAME figure on both sides — it cancels, so there is no
 * rounding gap, with or without a coupon or karma. Display only: nothing is charged
 * from this number, and it never feeds back into the total.
 *
 * @param {number} subtotal  GST-inclusive goods subtotal, rupees
 * @param {number} tax       GST embedded in the order, rupees
 * @returns {number} rupees, never negative
 */
export function subtotalBeforeTax(subtotal, tax) {
  return fromPaise(Math.max(0, toPaise(subtotal) - toPaise(tax)));
}

/**
 * Clamp an integer-paise value to the inclusive [min, max] range.
 * Used to cap discounts so they never exceed the amount they apply to.
 */
export function clampPaise(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
