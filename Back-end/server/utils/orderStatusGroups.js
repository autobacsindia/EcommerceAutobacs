/**
 * Order status groupings — the single source of truth for "which fulfilment
 * statuses count as X".
 *
 * These live here (not inside a service) so the reporting services, the admin
 * stat tiles and any future queue/export share one definition. Duplicating the
 * arrays is how the admin header ended up querying a field that does not exist
 * (`orderStatus`) and silently reporting 0 — see routes/adminStats.js.
 *
 * All values must exist in the `Order.status` enum (models/Order.js), with one
 * deliberate exception: `confirmed` is a legacy pre-migration value
 * (scripts/migrate-order-status-phase2.js) kept in the sale set so historical
 * revenue can't silently drop if any un-migrated row survives. Matching a value
 * that no document carries costs nothing.
 */

/** Realised sales — money made. Excludes cancelled / returned / awaiting_payment. */
export const SALE_STATUSES = Object.freeze(['confirmed', 'processing', 'shipped', 'delivered']);

/**
 * Open orders: a real (non-abandoned) order that has not reached the customer.
 * Deliberately excludes `awaiting_payment` — those are abandoned checkouts that
 * live in the CRM Leads section, not an admin work queue.
 */
export const PENDING_FULFILLMENT_STATUSES = Object.freeze(
  SALE_STATUSES.filter((s) => s !== 'delivered')
);
