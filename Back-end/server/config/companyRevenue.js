/**
 * Company revenue (admin header + /admin/revenue) — the closed lists and the
 * matching tolerances shared by models/ZohoInvoice.js, services/zohoInvoiceInput.js
 * and services/companyRevenueService.js.
 *
 * The rule the whole feature rests on (owner's decision, 2026-11-23): every sale
 * is counted ONCE, with Zoho Books as the book of record.
 *   - Every Zoho invoice is counted, net of its credit notes (refunds).
 *   - A website / WooCommerce / sales-panel order is counted (from its own
 *     snapshot) only when no Zoho invoice is that order.
 *   Zoho bills most website orders without the panel order number, so the match
 *   is by name + amount + date. When the match is unsure (needs_check) the order
 *   is treated as billed — the sale is counted once, through the invoice — until
 *   an admin says it is a separate sale. A doubtful sale is never counted twice.
 */

/** Zoho statuses that are not a real sale. Everything else (Closed, Overdue, Sent, Paid…) is. */
export const ZOHO_EXCLUDED_STATUSES = Object.freeze(['draft', 'void']);

/**
 * Where an invoice stands against the panel. The invoice itself always counts;
 * the state decides whether the panel order it points at is left out.
 *   linked      — the same sale as a panel order (auto or by an admin) → that order is not counted again
 *   needs_check — probably that panel order, not sure → order left out until an admin decides
 *   zoho_only   — no panel order like it (store / B2B / WhatsApp)
 */
export const ZOHO_MATCH_STATES = Object.freeze(['linked', 'needs_check', 'zoho_only']);
/** Match states whose `match.order` is treated as already billed (left out of the panel part). */
export const ZOHO_REPLACES_ORDER_STATES = Object.freeze(['linked', 'needs_check']);

/** How a match was decided. `admin` decisions survive every later re-import. */
export const ZOHO_MATCH_BY = Object.freeze(['auto', 'admin']);

export const MATCH_TOLERANCE = Object.freeze({
  /** Sure match: amount within ₹1 and dates within 7 days, and the name agrees. */
  sureAmountRupees: 1,
  sureDays: 7,
  /** Possible match (→ needs_check): amount within 2 % and dates within 15 days. */
  possibleAmountRatio: 0.02,
  possibleDays: 15,
  /** Amount within ₹1 and dates within 3 days is suspicious even when names differ (a company bill for a person's order). */
  sameAmountDays: 3,
});

/** Hard caps so an import can never become an unbounded scan. */
export const ZOHO_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const ZOHO_IMPORT_MAX_INVOICES = 5000;
export const MATCH_ORDER_SCAN_CAP = 50000;
