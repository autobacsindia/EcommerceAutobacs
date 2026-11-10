/**
 * Extra charges on an already-paid order (models/OrderExtraCharge.js).
 * One list of limits, shared by the validators and the service.
 */
export const MAX_EXTRA_RUPEES = Number(process.env.MAX_EXTRA_CHARGE_RUPEES) || 5000000; // ₹50 lakh: a typo guard, not a business limit
export const MIN_EXTRA_RUPEES = 1;
export const MAX_LIVE_EXTRAS = 10; // per order, not counting rejected / cancelled ones
export const MIN_REASON_CHARS = 5;
export const MAX_REASON_CHARS = 500;
export const MAX_NOTE_CHARS = 500;
/** An order in one of these can no longer take money: a paid extra goes back to the customer. */
export const CLOSED_ORDER_STATUSES = Object.freeze(['cancelled', 'returned']);
/** An extra can be raised only on a paid order that is still alive. */
export const EXTRA_ELIGIBLE_ORDER_STATUSES = Object.freeze(['processing', 'shipped', 'delivered']);
