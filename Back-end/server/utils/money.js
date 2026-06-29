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
 * Clamp an integer-paise value to the inclusive [min, max] range.
 * Used to cap discounts so they never exceed the amount they apply to.
 */
export function clampPaise(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
