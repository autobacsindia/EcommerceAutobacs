/**
 * Return / Refund / Cancellation policy constants — single source of truth.
 *
 * These encode the signed Roavion "Return, Refund, Exchange & Cancellation
 * Policy" (v1.0). Keep the numbers here and import them everywhere (controller,
 * validators, emails) so the 4-day window / restocking rules can never drift
 * between the backend and any one call site. The frontend mirrors these in
 * Front-end/web/src/lib/constants.ts — update both together.
 *
 * Scope note (deliberate, per operations sign-off 2026-07-31):
 *  - Exchanges and store-credit refunds are OUT. Every accepted return refunds
 *    to the original payment method; every accepted reason is a Roavion-fault
 *    reason. Shipping/restocking deductions are a manual, per-case decision the
 *    operator makes at refund-initiation time — never auto-applied to money.
 */

// Customers may raise a return only within this many days of delivery.
export const RETURN_WINDOW_DAYS = 4;

// The 10% restocking / warehouse-handling charge and the price threshold above
// which it MAY apply. Applying it is always an operator decision (the "oversized
// / volumetric" limb is judged by hand); this only bounds the suggestion.
export const RESTOCK_PCT = 10;
export const RESTOCK_THRESHOLD_RUPEES = 100000; // ₹1,00,000

// The only reasons a return is accepted for. All three are Roavion-attributable
// ("our fault") — there is no change-of-mind / buyer's-remorse path.
export const RETURN_REASONS = Object.freeze(['wrong_item', 'transit_damage', 'manufacturing_defect']);

// Why a product can never be returned. Set per-product in the admin editor
// (Product.returnPolicy.nonReturnReason); mirrors the policy's non-returnable list.
export const NON_RETURN_REASONS = Object.freeze(['electrical', 'custom', 'imported', 'installed']);

// Return statuses that BLOCK a fresh return for the same (order, product) pair.
// Everything except a customer-`cancelled` request is either in-flight or terminal
// and must not be duplicated; only cancelling frees the pair for a new attempt.
// This is the single source of truth shared by BOTH the controller pre-check AND
// the DB unique partial index (models/ReturnRequest.js + db.js
// ensureCriticalIndexes). We enumerate the positive set here because `$ne` is not a
// supported operator in a MongoDB partialFilterExpression — so the index must be
// expressed as `status: { $in: ACTIVE_RETURN_STATUSES }`, and the controller uses
// the same list so the two can never drift. Keep in lockstep with the schema enum.
export const ACTIVE_RETURN_STATUSES = Object.freeze([
  'pending', 'approved', 'courier_booked', 'received', 'refunded', 'rejected',
]);

/**
 * Returns still MOVING — raised, accepted, in the courier's hands, or received back but
 * not yet refunded.
 *
 * This is the set the DB unique index is scoped to: at most ONE in-flight return per
 * (order, product) at a time. That is what makes concurrent submissions safe — two
 * simultaneous POSTs both target `pending`, so the second hits E11000 instead of
 * creating a duplicate.
 *
 * Deliberately NARROWER than ACTIVE_RETURN_STATUSES. Blocking on the terminal `refunded`
 * too meant a customer who sent back 1 of 3 faulty items could never return the other 2 —
 * the UI invited a partial-quantity return and then made it a one-shot. Quantity is now
 * what bounds a repeat (see RETURN_QUANTITY_CONSUMING_STATUSES); being in flight is what
 * bounds concurrency.
 */
export const IN_FLIGHT_RETURN_STATUSES = Object.freeze([
  'pending', 'approved', 'courier_booked', 'received',
]);

/**
 * Statuses whose quantities are SPENT — the customer either has the return in progress
 * or has already been refunded for those units, so they cannot be claimed again.
 *
 * `rejected` is absent on purpose: those goods were never taken back, so the units are
 * not consumed. A rejected product is instead blocked outright (see the controller) —
 * an operator said no, and re-asking is a support conversation, not a self-serve retry.
 * `cancelled` is absent because the customer withdrew; those units are free again.
 */
export const RETURN_QUANTITY_CONSUMING_STATUSES = Object.freeze([
  'pending', 'approved', 'courier_booked', 'received', 'refunded',
]);

// Human labels for the reasons (emails, admin UI copy).
export const RETURN_REASON_LABELS = Object.freeze({
  wrong_item: 'Wrong item shipped',
  transit_damage: 'Damaged in transit',
  manufacturing_defect: 'Manufacturing defect',
});

/**
 * Suggested restocking deduction (rupees) for a single returned line — the price
 * threshold limb only. The oversized/volumetric limb has no dimension data to
 * compute from, so it is left to the operator to add manually at refund time.
 * @param {number} unitPriceRupees - charged price of one unit
 * @param {number} quantity
 * @returns {number} suggested restocking amount in rupees (0 when under threshold)
 */
export const suggestedRestockingRupees = (unitPriceRupees, quantity = 1) => {
  const price = Number(unitPriceRupees) || 0;
  if (price <= RESTOCK_THRESHOLD_RUPEES) return 0;
  return Math.round(price * (quantity || 1) * (RESTOCK_PCT / 100));
};

export default {
  RETURN_WINDOW_DAYS,
  RESTOCK_PCT,
  RESTOCK_THRESHOLD_RUPEES,
  RETURN_REASONS,
  NON_RETURN_REASONS,
  ACTIVE_RETURN_STATUSES,
  IN_FLIGHT_RETURN_STATUSES,
  RETURN_QUANTITY_CONSUMING_STATUSES,
  RETURN_REASON_LABELS,
  suggestedRestockingRupees,
};
