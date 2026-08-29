/**
 * Split-shipment maths — how much of an order has actually left the building.
 *
 * An order used to be one parcel: a single `trackingNumber`, a single `deliveredAt`,
 * a single `status`. Real orders ship in pieces (stock arrives at different times, an
 * oversized item goes by a different courier), so `Order.shipments[]` records each
 * parcel and THIS module answers the only questions that matter about them:
 * what is still owed, and what the order's overall status should therefore be.
 *
 * ── DESIGN: the order status stays DERIVED ────────────────────────────────────────
 * `Order.status` keeps its existing six values and is rolled up from the shipments.
 * We deliberately did NOT add a `partially_shipped` enum value: that would ripple
 * through every consumer that switches on status (admin filters, the
 * {status,createdAt} index, CRM lead classification, analytics) for no storage
 * benefit. Partiality is a DISPLAY label, computed by `fulfilmentSummary`.
 *
 * ── THE GOODIE COUNTS ─────────────────────────────────────────────────────────────
 * A won physical goodie is part of the parcel, so an order is not fully shipped (or
 * delivered) until the gift has gone too. That is what replaces the old "don't forget
 * the goodie" banner: the order simply cannot complete. Non-physical prizes (coupon,
 * karma) and withdrawn ones must NOT count, or the order can never complete at all —
 * see `owesGoodie` in utils/orderLines.js.
 *
 * Pure functions only: no DB, no I/O. Everything here is unit-testable.
 */

import { owesGoodie } from './orderLines.js';

/** A shipment that has left the building (or is about to). */
export const SHIPMENT_STATUS = Object.freeze({
  PACKED: 'packed',       // built, not yet handed to the courier
  SHIPPED: 'shipped',     // in transit
  DELIVERED: 'delivered', // arrived
  LOST: 'lost',           // written off; its units go back to "still owed"
});

export const SHIPMENT_STATUSES = Object.freeze(Object.values(SHIPMENT_STATUS));

/**
 * Shipments whose contents still count as committed to the customer.
 *
 * A `lost` parcel does NOT: its units return to the remaining-to-ship pool so a
 * replacement can be sent. Anything else would leave the order permanently short and
 * un-completable, with no way to re-ship the missing item.
 */
const COMMITTED = new Set([SHIPMENT_STATUS.PACKED, SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.DELIVERED]);

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/**
 * Quantity of each order item accounted for by shipments in the given states.
 *
 * @param {object} order
 * @param {Set<string>} states - shipment statuses to count
 * @returns {Map<string, number>} itemId → quantity
 */
const quantityByItem = (order, states) => {
  const totals = new Map();
  for (const shipment of order?.shipments || []) {
    if (!states.has(shipment.status)) continue;
    for (const line of shipment.lines || []) {
      const key = idOf(line.itemId);
      totals.set(key, (totals.get(key) || 0) + (line.quantity || 0));
    }
  }
  return totals;
};

/** Quantity of each item already committed to a parcel (packed/shipped/delivered). */
export const shippedQuantityByItem = (order) => quantityByItem(order, COMMITTED);

/** Quantity of each item that has actually arrived. */
export const deliveredQuantityByItem = (order) =>
  quantityByItem(order, new Set([SHIPMENT_STATUS.DELIVERED]));

/**
 * What is still waiting to go in a box.
 *
 * @param {object} order
 * @returns {Array<{itemId: string, name: string|null, quantity: number}>} lines with
 *   a non-zero remainder; items fully shipped are omitted.
 */
export const remainingToShip = (order) => {
  const shipped = shippedQuantityByItem(order);
  return (order?.items || [])
    .map((item) => {
      const id = idOf(item._id);
      return {
        itemId: id,
        name: item.name || item.product?.name || null,
        quantity: (item.quantity || 0) - (shipped.get(id) || 0),
      };
    })
    .filter((line) => line.quantity > 0);
};

/**
 * Is the won goodie already committed to a parcel?
 * Vacuously true when the order owes no goodie, so a gift-less order is never blocked.
 */
export const rewardShipped = (order) => {
  if (!owesGoodie(order)) return true;
  return (order?.shipments || []).some((s) => s.includesReward && COMMITTED.has(s.status));
};

/** Has the won goodie actually arrived? Vacuously true when none is owed. */
export const rewardDelivered = (order) => {
  if (!owesGoodie(order)) return true;
  return (order?.shipments || []).some(
    (s) => s.includesReward && s.status === SHIPMENT_STATUS.DELIVERED,
  );
};

/** Every ordered unit is in a parcel, and so is the gift. */
export const isFullyShipped = (order) =>
  remainingToShip(order).length === 0 && rewardShipped(order);

/** Every ordered unit has arrived, and so has the gift. */
export const isFullyDelivered = (order) => {
  const delivered = deliveredQuantityByItem(order);
  const everyItemArrived = (order?.items || []).every(
    (item) => (delivered.get(idOf(item._id)) || 0) >= (item.quantity || 0),
  );
  return everyItemArrived && rewardDelivered(order);
};

/** At least one parcel has been handed to a courier. */
export const hasShippedAnything = (order) =>
  (order?.shipments || []).some((s) =>
    s.status === SHIPMENT_STATUS.SHIPPED || s.status === SHIPMENT_STATUS.DELIVERED);

/**
 * Statuses the roll-up must never overwrite.
 *
 * `cancelled` and `returned` are terminal decisions made by a human about the whole
 * order; a parcel event must not resurrect one. `awaiting_payment` is the pre-payment
 * state — shipping something must not silently mark an unpaid order as progressing.
 */
const NOT_ROLLED_UP = new Set(['cancelled', 'returned', 'awaiting_payment']);

/**
 * The order-level status implied by its parcels.
 *
 * ⚠️ Returns the CURRENT status unchanged when there are no shipments. Historical
 * orders (every order placed before split shipments existed) carry none, so they can
 * never be recomputed backwards out of `delivered` by this function.
 *
 * @param {object} order
 * @returns {string} the status the order should now hold
 */
export const rollUpStatus = (order) => {
  const current = order?.status;
  if (NOT_ROLLED_UP.has(current)) return current;
  if (!(order?.shipments || []).length) return current;

  if (isFullyDelivered(order)) return 'delivered';
  if (hasShippedAnything(order)) return 'shipped';

  /*
    Nothing is in transit and nothing has arrived — every parcel is either still being
    packed or has been written off as lost. The order is back to being prepared.

    This deliberately WALKS THE STATUS BACK from `shipped` when the only parcel is
    written off. Keeping it at `shipped` would tell the customer their goods are on the
    way when the courier has lost them and a replacement has not been sent; it would
    also leave the order un-cancellable, because cancel is blocked after dispatch. An
    order whose only parcel is lost is exactly one someone may need to cancel.

    Historical orders can never reach this line — the no-shipments guard above returns
    first — so no delivered order in the existing data can be dragged backwards.
  */
  return 'processing';
};

/**
 * When did THIS line actually arrive?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────
 * The return window (4 days, config/returnPolicy.js) runs from delivery. With one
 * parcel per order there was one delivery date and the order-level `deliveredAt` was
 * correct for everything. Split shipments break that: item A arrives Monday, item B the
 * following Friday, and a single order-level date is wrong for one of them — either A's
 * window silently runs long, or B's expires before the customer ever had it.
 *
 * ⚠️ LEGACY ORDERS: with no shipments this falls back to the order-level date, so every
 * historical order behaves exactly as it did before parcels existed.
 *
 * When an item was split across parcels that arrived on different days, the LATEST
 * delivery wins. That is deliberate: the customer did not hold the full quantity until
 * the last one landed, and on a genuinely ambiguous date the benefit belongs to the
 * buyer, not to us.
 *
 * @param {object} order
 * @param {string} itemId - an `Order.items[]._id`
 * @returns {Date|null} when it arrived, or null if it has not
 */
export const deliveredAtForItem = (order, itemId) => {
  const id = idOf(itemId);
  const dates = (order?.shipments || [])
    .filter((s) =>
      s.status === SHIPMENT_STATUS.DELIVERED &&
      s.deliveredAt &&
      (s.lines || []).some((l) => idOf(l.itemId) === id))
    .map((s) => new Date(s.deliveredAt).getTime());

  if (dates.length) return new Date(Math.max(...dates));

  // No parcel delivered this line. For an order that predates parcels the order-level
  // date is the only truth there is; for a live split order, "not yet delivered".
  if ((order?.shipments || []).length) return null;

  const fallback = order?.fulfillmentMetrics?.deliveredAt || order?.deliveredAt;
  return fallback ? new Date(fallback) : null;
};

/**
 * Delivery date for the won goodie, on the same rules as a line item.
 * @param {object} order
 * @returns {Date|null}
 */
export const deliveredAtForReward = (order) => {
  const dates = (order?.shipments || [])
    .filter((s) => s.includesReward && s.status === SHIPMENT_STATUS.DELIVERED && s.deliveredAt)
    .map((s) => new Date(s.deliveredAt).getTime());
  if (dates.length) return new Date(Math.max(...dates));
  if ((order?.shipments || []).length) return null;
  const fallback = order?.fulfillmentMetrics?.deliveredAt || order?.deliveredAt;
  return fallback ? new Date(fallback) : null;
};

/**
 * Has this line reached the customer? The precondition for returning it.
 * @param {object} order
 * @param {string} itemId
 * @returns {boolean}
 */
export const isItemDelivered = (order, itemId) => Boolean(deliveredAtForItem(order, itemId));

/**
 * Everything a UI needs to describe fulfilment in words, without inventing a status.
 *
 * @param {object} order
 * @returns {{totalUnits:number, shippedUnits:number, deliveredUnits:number,
 *   parcelCount:number, owesGoodie:boolean, rewardShipped:boolean,
 *   fullyShipped:boolean, fullyDelivered:boolean, partial:boolean, label:string}}
 */
export const fulfilmentSummary = (order) => {
  const shipped = shippedQuantityByItem(order);
  const delivered = deliveredQuantityByItem(order);
  const items = order?.items || [];

  // The gift counts as one more unit to ship, so "3 of 4 items" tells the truth about
  // a parcel that still owes the goodie.
  const giftUnits = owesGoodie(order) ? 1 : 0;
  const totalUnits = items.reduce((n, i) => n + (i.quantity || 0), 0) + giftUnits;
  const shippedUnits =
    items.reduce((n, i) => n + Math.min(i.quantity || 0, shipped.get(idOf(i._id)) || 0), 0) +
    (giftUnits && rewardShipped(order) ? 1 : 0);
  const deliveredUnits =
    items.reduce((n, i) => n + Math.min(i.quantity || 0, delivered.get(idOf(i._id)) || 0), 0) +
    (giftUnits && rewardDelivered(order) ? 1 : 0);

  const parcelCount = (order?.shipments || []).filter((s) => s.status !== SHIPMENT_STATUS.LOST).length;
  const fullyShipped = isFullyShipped(order);
  const fullyDelivered = isFullyDelivered(order);
  const partial = shippedUnits > 0 && !fullyShipped;

  let label;
  if (fullyDelivered) label = 'Delivered';
  else if (deliveredUnits > 0 && !fullyDelivered) label = `Partially delivered · ${deliveredUnits} of ${totalUnits} items`;
  else if (partial) label = `Partially shipped · ${shippedUnits} of ${totalUnits} items`;
  else if (fullyShipped) label = 'Shipped';
  else label = 'Preparing';

  return {
    totalUnits, shippedUnits, deliveredUnits, parcelCount,
    owesGoodie: Boolean(giftUnits),
    rewardShipped: rewardShipped(order),
    fullyShipped, fullyDelivered, partial, label,
  };
};

/**
 * Validate a proposed parcel against what the order still owes.
 *
 * The over-ship guard. Callers MUST run this inside the same atomic write that pushes
 * the shipment, or two admins shipping at once can each pass validation and together
 * commit more units than were ordered.
 *
 * @param {object} order
 * @param {{lines: Array<{itemId: string, quantity: number}>, includesReward?: boolean}} proposed
 * @returns {{valid: boolean, message?: string}}
 */
export const validateProposedShipment = (order, proposed) => {
  const lines = proposed?.lines || [];
  if (!lines.length && !proposed?.includesReward) {
    return { valid: false, message: 'A shipment must contain at least one item.' };
  }

  const remaining = new Map(remainingToShip(order).map((l) => [l.itemId, l.quantity]));
  const seen = new Set();

  for (const line of lines) {
    const id = idOf(line.itemId);
    if (seen.has(id)) {
      return { valid: false, message: `Item ${id} appears twice in the same shipment.` };
    }
    seen.add(id);

    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return { valid: false, message: `Quantity for item ${id} must be a positive whole number.` };
    }
    if (!(order.items || []).some((i) => idOf(i._id) === id)) {
      return { valid: false, message: `Item ${id} is not part of this order.` };
    }
    const left = remaining.get(id) || 0;
    if (qty > left) {
      return {
        valid: false,
        message: `Cannot ship ${qty} of item ${id} — only ${left} left to ship.`,
      };
    }
  }

  if (proposed?.includesReward) {
    if (!owesGoodie(order)) {
      return { valid: false, message: 'This order has no goodie to send.' };
    }
    if (rewardShipped(order)) {
      return { valid: false, message: 'The goodie is already in another parcel.' };
    }
  }

  return { valid: true };
};

export default {
  SHIPMENT_STATUS, SHIPMENT_STATUSES,
  shippedQuantityByItem, deliveredQuantityByItem, remainingToShip,
  deliveredAtForItem, deliveredAtForReward, isItemDelivered,
  rewardShipped, rewardDelivered, isFullyShipped, isFullyDelivered,
  hasShippedAnything, rollUpStatus, fulfilmentSummary, validateProposedShipment,
};
