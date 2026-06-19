// Stock is tracked as a coarse availability status rather than a numeric
// quantity. Admins set the status directly; the storefront shows only the
// label. There is no per-unit deduction or oversell guard — an item is
// purchasable as long as it is not explicitly marked out of stock.

export const STOCK_STATUS = Object.freeze({
  IN: 'in',
  LOW: 'low',
  OUT: 'out',
});

// Allowed enum values (used by the Mongoose schema and request validators).
export const STOCK_VALUES = Object.freeze(Object.values(STOCK_STATUS));

// Human-readable labels for display / logs.
export const STOCK_LABELS = Object.freeze({
  [STOCK_STATUS.IN]:  'In Stock',
  [STOCK_STATUS.LOW]: 'Low Stock',
  [STOCK_STATUS.OUT]: 'Out of Stock',
});

/** True when an item can be added to cart / ordered. */
export function isPurchasable(status) {
  return status !== STOCK_STATUS.OUT;
}

/**
 * Normalize a legacy numeric quantity to a status value.
 * Used by importers/sync that still receive numeric quantities upstream
 * (e.g. WooCommerce stock_quantity) and by the one-off migration script.
 *
 * @param {number} qty
 * @param {number} [lowThreshold=5] units at or below this (but >0) = low
 */
export function statusFromQuantity(qty, lowThreshold = 5) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return STOCK_STATUS.OUT;
  if (n <= lowThreshold) return STOCK_STATUS.LOW;
  return STOCK_STATUS.IN;
}
