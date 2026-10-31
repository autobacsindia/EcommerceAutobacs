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
 *    to the original payment method. Deductions are a per-case decision the
 *    operator makes — never auto-applied to money.
 *  - 2026-10-30 (owner-approved): customer-reason returns are back (unused, in the
 *    box, returnable product only), and every line carries a FAULT that decides the
 *    money — see FAULTS and services/refundMathService.returnRefundBreakdown.
 */

// Customers may raise a return only within this many days of delivery — for a
// CUSTOMER-reason return (ordered wrong, changed mind). Kept under its old name
// because it is also the strictest window, which is what older callers meant by it.
export const RETURN_WINDOW_DAYS = 4;

/**
 * Who caused the problem. Decides what the customer gets back (rule 1 of the
 * owner-approved return rules, 2026-10-30):
 *   ours     → goods net paid + a share of the original shipping + the installation
 *              line(s); we pay for the pickup.
 *   customer → goods net paid only; the real pickup cost is deducted.
 * The customer's reason only CLAIMS a fault. Operations confirms it per line.
 */
export const FAULTS = Object.freeze(['ours', 'customer']);
export const FAULT_LABELS = Object.freeze({ ours: 'Our fault', customer: "Customer's reason" });

// Days from delivery, per fault. Our-fault goods get longer: defects surface late.
export const RETURN_WINDOW_DAYS_BY_FAULT = Object.freeze({ ours: 7, customer: RETURN_WINDOW_DAYS });

// The longest window any line can have. Anything that must wait until NO return can
// still be raised (affiliate commission maturity) waits this long.
export const LONGEST_RETURN_WINDOW_DAYS = Math.max(...Object.values(RETURN_WINDOW_DAYS_BY_FAULT));

// A video is required for transit damage, and for any line worth more than this.
export const VIDEO_REQUIRED_ABOVE_RUPEES = 10000;

// Accounts members may send a return refund up to this much; above it needs the
// accounts head or an admin.
export const ACCOUNTS_REFUND_LIMIT_RUPEES = 25000;

// Failed pickup attempts that cancel a return automatically.
export const MAX_FAILED_PICKUPS = 2;

// What happens to a returned item after inspection. A RECORD only — stock stays the
// coarse in/low/out enum, so nothing here moves a quantity.
export const DISPOSITIONS = Object.freeze(['resell', 'open_box', 'return_to_supplier', 'scrap']);
export const DISPOSITION_LABELS = Object.freeze({
  resell: 'Resell', open_box: 'Sell as open-box', return_to_supplier: 'Send back to supplier', scrap: 'Scrap',
});

// Where an approved return goes. Operations confirms it at check 1; the system
// pre-fills "Supplier: <name>" from the order's workflow line when one is known.
export const RETURN_DESTINATIONS = Object.freeze(['warehouse', 'supplier']);

// How the item travels back.
//   courier          → we book a courier to our warehouse (operations)
//   dropped_at_store → the customer brought it in (operations)
//   supplier_direct  → it goes straight to the supplier (procurement); the supplier
//                      or we book the courier
export const PICKUP_MODES = Object.freeze(['courier', 'dropped_at_store', 'supplier_direct']);

// After a failed inspection (customer damage): send it back at the customer's cost,
// or hold it for HOLD_REJECTED_DAYS and then dispose of it.
export const FAILED_INSPECTION_ACTIONS = Object.freeze(['send_back', 'hold']);
export const HOLD_REJECTED_DAYS = 30;

/*
  The supplier track (rule 9.5B) — procurement chases the supplier by hand; accounts
  confirms the money arrived. Independent of the customer refund: neither waits.

    open                → procurement has to contact the supplier
    accepted / rejected → the supplier's answer (a rejection of a claim operations
                          confirmed as our fault is a LOSS against that supplier)
    promised            → the supplier promised a settlement (amount + reference)
    settled             → accounts confirmed the money (or the replacement) arrived
*/
export const SUPPLIER_CLAIM_STATUSES = Object.freeze(['open', 'accepted', 'rejected', 'promised', 'settled']);
export const SUPPLIER_SETTLEMENT_KINDS = Object.freeze(['credit_note', 'refund', 'free_replacement']);
export const SUPPLIER_SETTLEMENT_LABELS = Object.freeze({
  credit_note: 'Credit note', refund: 'Refund to us', free_replacement: 'Free replacement',
});
// How promised money reached us: into the bank (UTR), or taken off a later supplier bill.
export const SUPPLIER_MONEY_METHODS = Object.freeze(['bank', 'deducted']);

// The repeat-returner flag counts requests over this many days. A flag, never a block.
export const REPEAT_RETURNER_DAYS = 183;

// The 10% restocking / warehouse-handling charge and the price threshold above
// which it MAY apply. Applying it is always an operator decision (the "oversized
// / volumetric" limb is judged by hand); this only bounds the suggestion.
export const RESTOCK_PCT = 10;
export const RESTOCK_THRESHOLD_RUPEES = 100000; // ₹1,00,000

// Every reason a return line can carry, and the fault each one CLAIMS. The first
// three are the original July set; old rows keep validating against this list.
export const REASON_FAULT = Object.freeze({
  wrong_item: 'ours',
  transit_damage: 'ours',
  manufacturing_defect: 'ours',
  missing_part: 'ours',
  wrong_fitment_info: 'ours',   // our website said it fits, and it does not
  installer_damage: 'ours',     // our installer caused it — staff only, goes to admin
  ordered_wrong: 'customer',    // wrong model / size
  changed_mind: 'customer',
});
export const RETURN_REASONS = Object.freeze(Object.keys(REASON_FAULT));

// The July set — all our fault. The storefront form still offers only these until it
// gains the fault-based rules (unused-in-box declaration, per-fault window, evidence).
export const ORIGINAL_REASONS = Object.freeze(['wrong_item', 'transit_damage', 'manufacturing_defect']);

// Reasons only staff may record. A customer cannot self-certify installer damage.
export const STAFF_ONLY_REASONS = Object.freeze(['installer_damage']);
export const CUSTOMER_REASONS = Object.freeze(RETURN_REASONS.filter((r) => !STAFF_ONLY_REASONS.includes(r)));

/** The fault a reason claims ('ours' for anything unknown — the legacy default). */
export const claimedFaultFor = (reason) => REASON_FAULT[reason] || 'ours';

/**
 * The fault that decides a line's money: operations' confirmation when it exists,
 * else what the reason claimed. Rows from before faults existed carry neither and
 * resolve through their reason, which was always an our-fault one.
 */
export const effectiveFault = (item) => {
  const confirmed = item?.fault?.confirmed;
  if (FAULTS.includes(confirmed)) return confirmed;
  const claimed = item?.fault?.claimed;
  if (FAULTS.includes(claimed)) return claimed;
  return claimedFaultFor(item?.reason);
};

/** Days a line may be returned in, from its delivery. */
export const windowDaysFor = (fault) => RETURN_WINDOW_DAYS_BY_FAULT[fault] ?? RETURN_WINDOW_DAYS;

/** Is a video required for this line? Transit damage always; otherwise above the threshold. */
export const videoRequiredFor = ({ reason, unitPrice, quantity }) =>
  reason === 'transit_damage'
  || (Number(unitPrice) || 0) * (Number(quantity) || 1) > VIDEO_REQUIRED_ABOVE_RUPEES;

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
  missing_part: 'Missing part',
  wrong_fitment_info: 'Website said it fits, but it does not',
  installer_damage: 'Damaged by our installer',
  ordered_wrong: 'Ordered the wrong model or size',
  changed_mind: 'Changed my mind',
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
  FAULTS,
  RETURN_WINDOW_DAYS_BY_FAULT,
  LONGEST_RETURN_WINDOW_DAYS,
  VIDEO_REQUIRED_ABOVE_RUPEES,
  ACCOUNTS_REFUND_LIMIT_RUPEES,
  MAX_FAILED_PICKUPS,
  DISPOSITIONS,
  RETURN_DESTINATIONS,
  PICKUP_MODES,
  FAILED_INSPECTION_ACTIONS,
  SUPPLIER_CLAIM_STATUSES,
  SUPPLIER_SETTLEMENT_KINDS,
  SUPPLIER_MONEY_METHODS,
  REASON_FAULT,
  ORIGINAL_REASONS,
  STAFF_ONLY_REASONS,
  CUSTOMER_REASONS,
  claimedFaultFor,
  effectiveFault,
  windowDaysFor,
  videoRequiredFor,
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
