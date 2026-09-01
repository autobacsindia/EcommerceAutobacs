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

/**
 * The statuses a shopper cannot buy — the single definition both search engines
 * filter on for `inStock=true`.
 *
 * This exists because the two engines disagreed in production. Atlas excluded
 * ['out','backorder'] while the MongoDB fallback excluded only 'out', so the same
 * `?inStock=true` URL returned 20 backorder products on one path and hid them on
 * the other, depending purely on whether the Atlas index happened to be READY.
 * `isPurchasable()` above already said both are non-purchasable, so the fallback
 * was the one contradicting the domain model.
 *
 * Derived from isPurchasable() rather than written out again, so a future status
 * cannot be added to the enum and silently missed by the search filters.
 */
export const NON_PURCHASABLE_STOCK = Object.freeze(
  STOCK_VALUES.filter((s) => !isPurchasable(s))
);

/** The complement — used by the Atlas availability boost, which scores what IS buyable. */
export const PURCHASABLE_STOCK = Object.freeze(STOCK_VALUES.filter(isPurchasable));

/**
 * Sort rank for availability: 0 = buyable, 1 = not.
 *
 * This exists because sorting on the `stock` STRING is actively wrong. The enum
 * sorts alphabetically as backorder < in < low < out, so the long-standing
 * `.sort({ stock: 1 })` — written when the enum was only in/low/out, and commented
 * "'in' < 'low' < 'out'" — silently inverted the moment `backorder` was added:
 * every browse page led with the products nobody can buy. Atlas has the same
 * problem from the other direction, because an explicit `sort` makes it ignore
 * relevance score entirely, so the availability BOOST does nothing on browse pages.
 *
 * A numeric rank is the only thing both engines can sort on and agree about. Two
 * tiers, not four: the distinction that matters to a shopper is "can I buy this",
 * and a coarser key keeps the sort stable when a product moves between `in` and
 * `low`.
 *
 * @param {string} status a STOCK_STATUS value
 * @returns {0|1} 0 for purchasable, 1 for out/backorder
 */
export function stockRankFor(status) {
  return isPurchasable(status) ? 0 : 1;
}

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
