/**
 * Order cancellation reasons — single source of truth.
 *
 * Every cancel screen picks from one of these lists, and orderStatusService accepts
 * exactly the codes listed here. They drifted apart once: the customer pop-up sent
 * `payment_failed` and the admin bulk bar sent `payment_issue` / `quality_issue` /
 * `other`, none of which the service allowed, so those cancels were refused. The
 * frontend mirrors these in Front-end/web/src/lib/constants.ts — update both together.
 *
 * Each `value` is unique within its list: the customer pop-up renders the list as a
 * radio group, and two options sharing a value light up together.
 */

// What a customer can pick in the "Cancel Order" pop-up.
export const CUSTOMER_CANCELLATION_REASONS = Object.freeze([
  { value: 'changed_mind', label: 'Changed my mind' },
  { value: 'better_price', label: 'Found a better price elsewhere' },
  { value: 'ordered_by_mistake', label: 'Ordered by mistake' },
  { value: 'payment_issue', label: 'Payment issues' },
  { value: 'other', label: 'Other' },
]);

// What staff pick when cancelling (per-line panel, bulk bar).
export const ADMIN_CANCELLATION_REASONS = Object.freeze([
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'customer_request', label: 'Customer asked for it' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'fraud_suspected', label: 'Fraud suspected' },
  { value: 'payment_issue', label: 'Payment issue' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'other', label: 'Other' },
]);

/*
  Codes still accepted but no longer offered. `payment_failed` was what the customer
  pop-up sent for "Payment issues" before this list existed; a browser holding the old
  page keeps sending it until it reloads, and refusing that cancel helps nobody.
*/
const LEGACY_CANCELLATION_REASONS = Object.freeze([
  { value: 'payment_failed', label: 'Payment issues' },
]);

export const CANCELLATION_REASON_LABELS = Object.freeze(Object.fromEntries(
  [...LEGACY_CANCELLATION_REASONS, ...ADMIN_CANCELLATION_REASONS, ...CUSTOMER_CANCELLATION_REASONS]
    .map((r) => [r.value, r.label]),
));

// Every code a cancel may carry, from any screen.
export const CANCELLATION_REASON_CODES = Object.freeze(Object.keys(CANCELLATION_REASON_LABELS));

/** Readable label for a stored code; unknown/older free-text values pass through. */
export function cancellationReasonLabel(code) {
  if (!code) return '';
  return CANCELLATION_REASON_LABELS[code] || code;
}
