// Stock is tracked as a coarse availability status rather than a numeric
// quantity. Admins set the status directly; the storefront shows only the
// label. There is no per-unit deduction or oversell guard — an item is
// purchasable as long as it is not explicitly marked out of stock.

export const STOCK_STATUS = Object.freeze({
  IN: 'in',
  LOW: 'low',
  OUT: 'out',
  // Not on hand, but still orderable — ships when restocked. Purchasable.
  BACKORDER: 'backorder',
});

// Allowed enum values (used by the Mongoose schema and request validators).
export const STOCK_VALUES = Object.freeze(Object.values(STOCK_STATUS));

// Human-readable labels for display / logs.
export const STOCK_LABELS = Object.freeze({
  [STOCK_STATUS.IN]:  'In Stock',
  [STOCK_STATUS.LOW]: 'Low Stock',
  [STOCK_STATUS.OUT]: 'Out of Stock',
  [STOCK_STATUS.BACKORDER]: 'On Backorder',
});

/**
 * True when an item can be added to cart / ordered directly. Out of stock and
 * backorder are both non-purchasable: out is unavailable, backorder is
 * enquiry-only (routed to the consultation flow, not the cart).
 */
export function isPurchasable(status) {
  return status !== STOCK_STATUS.OUT && status !== STOCK_STATUS.BACKORDER;
}

/** True when the item is orderable only via the enquiry/consultation flow. */
export function isEnquiryOnly(status) {
  return status === STOCK_STATUS.BACKORDER;
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

/**
 * Coerce any stored `stock` value to a valid status. Belt-and-suspenders for
 * pre-migration data where `stock` may still be a number (or a numeric string
 * after Mongoose String-casts it). Already-valid statuses pass through; numeric
 * values are mapped by quantity; anything else defaults to in stock.
 *
 * @param {*} value
 * @returns {'in'|'low'|'out'}
 */
export function normalizeStockValue(value) {
  if (STOCK_VALUES.includes(value)) return value;
  if (value != null && value !== '' && !Number.isNaN(Number(value))) {
    return statusFromQuantity(value);
  }
  return STOCK_STATUS.IN;
}
