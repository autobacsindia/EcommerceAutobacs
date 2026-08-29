/**
 * Partial-cancellation maths — which units of an order are still live.
 *
 * A cancellation is the pre-delivery twin of a return: the customer is not getting
 * those units, and their money comes back. The difference is that nothing physically
 * moves, so a cancelled unit must simply stop counting — towards what is left to ship,
 * towards whether the order can complete, and towards what may be cancelled again.
 *
 * ── THE ONE RULE THAT MATTERS ─────────────────────────────────────────────────────
 * `cancelled + committed-to-a-parcel <= ordered`, per line, always. Both sides consume
 * the same finite pool of units. Cancelling something already in a shipped box would
 * refund goods that are on their way to the customer; shipping something already
 * cancelled and refunded ships goods we have been paid nothing for. The functions here
 * answer "how many are still free", and services/cancellationService.js enforces it
 * atomically, because two admins acting at once would each pass a read-then-write check
 * and together break it.
 *
 * ── PACKED IS CANCELLABLE, SHIPPED IS NOT ────────────────────────────────────────
 * A `packed` parcel has not left the building, so its units can be pulled back out and
 * cancelled. Once a parcel is `shipped` or `delivered` the goods are gone and the
 * customer's route is a RETURN, which has its own window, its own evidence rules and
 * its own refund path. A `lost` parcel already returns its units to the pool.
 *
 * ── ORDER TOTALS ARE NOT TOUCHED ─────────────────────────────────────────────────
 * Nothing here recomputes `totalAmount`. The order records what was charged; the
 * refund records the adjustment. See the note on `Order.cancellations` in models/Order.js.
 *
 * Pure functions only: no DB, no I/O, no money. Money lives in refundMathService.
 */

import { SHIPMENT_STATUS } from './orderFulfilment.js';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/**
 * Parcel states whose contents are beyond recall.
 *
 * `packed` is deliberately ABSENT: that box has not gone anywhere, so the service can
 * pull a line out of it and cancel the units. `lost` is absent because its units have
 * already gone back into the pool.
 */
const IRREVERSIBLE = new Set([SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.DELIVERED]);

/**
 * Units of each item already cancelled.
 * @param {object} order
 * @returns {Map<string, number>} itemId → quantity
 */
export const cancelledQuantityByItem = (order) => {
  const totals = new Map();
  for (const cancellation of order?.cancellations || []) {
    for (const line of cancellation.lines || []) {
      const key = idOf(line.itemId);
      totals.set(key, (totals.get(key) || 0) + (line.quantity || 0));
    }
  }
  return totals;
};

/**
 * Units of each item that have physically gone (shipped or delivered) and so can never
 * be cancelled — only returned.
 * @param {object} order
 * @returns {Map<string, number>} itemId → quantity
 */
export const goneQuantityByItem = (order) => {
  const totals = new Map();
  for (const shipment of order?.shipments || []) {
    if (!IRREVERSIBLE.has(shipment.status)) continue;
    for (const line of shipment.lines || []) {
      const key = idOf(line.itemId);
      totals.set(key, (totals.get(key) || 0) + (line.quantity || 0));
    }
  }
  return totals;
};

/**
 * Units of each item still owed to the customer: ordered, minus cancelled.
 *
 * This is the figure every downstream question is really asking — "is the order
 * complete", "what is left to ship", "what can still be cancelled" — because a
 * cancelled unit is not owed and must not hold the order open.
 *
 * @param {object} order
 * @returns {Map<string, number>} itemId → quantity
 */
export const liveQuantityByItem = (order) => {
  const cancelled = cancelledQuantityByItem(order);
  const live = new Map();
  for (const item of order?.items || []) {
    const id = idOf(item._id);
    live.set(id, Math.max(0, (item.quantity || 0) - (cancelled.get(id) || 0)));
  }
  return live;
};

/**
 * What an admin may still cancel, and why the rest is unavailable.
 *
 * A line is cancellable up to `ordered − cancelled − gone`. Units sitting in a `packed`
 * parcel stay cancellable (the service pulls them out first), which is why `gone`
 * counts only shipped/delivered.
 *
 * @param {object} order
 * @returns {Array<{itemId:string, name:string|null, quantity:number, packed:number}>}
 *   lines with a non-zero cancellable remainder. `packed` is how many of those units
 *   are currently in an unshipped box, so the UI can warn that a parcel will be edited.
 */
export const remainingCancellable = (order) => {
  const cancelled = cancelledQuantityByItem(order);
  const gone = goneQuantityByItem(order);

  const packedByItem = new Map();
  for (const shipment of order?.shipments || []) {
    if (shipment.status !== SHIPMENT_STATUS.PACKED) continue;
    for (const line of shipment.lines || []) {
      const key = idOf(line.itemId);
      packedByItem.set(key, (packedByItem.get(key) || 0) + (line.quantity || 0));
    }
  }

  return (order?.items || [])
    .map((item) => {
      const id = idOf(item._id);
      const available = (item.quantity || 0) - (cancelled.get(id) || 0) - (gone.get(id) || 0);
      return {
        itemId: id,
        name: item.name || item.product?.name || null,
        quantity: Math.max(0, available),
        // Capped at what is actually available: a packed count can exceed it only if
        // the data is already inconsistent, and reporting more than can be cancelled
        // would put a warning on a line the admin cannot act on anyway.
        packed: Math.min(Math.max(0, available), packedByItem.get(id) || 0),
      };
    })
    .filter((line) => line.quantity > 0);
};

/** Not a single live unit remains — the order as a whole is cancelled. */
export const isFullyCancelled = (order) => {
  const items = order?.items || [];
  if (!items.length) return false;
  if (!(order?.cancellations || []).length) return false;
  const live = liveQuantityByItem(order);
  return items.every((item) => (live.get(idOf(item._id)) || 0) === 0);
};

/** Has anything at all been cancelled? Distinguishes "partly cancelled" from "intact". */
export const hasCancellations = (order) => (order?.cancellations || []).length > 0;

/**
 * Would this cancellation be legal against the order as it stands?
 *
 * Called immediately before the atomic write, and again by nothing else — the write
 * itself is conditional on the cancellations array being unchanged since this ran, so a
 * concurrent cancellation invalidates the check rather than slipping past it.
 *
 * @param {object} order
 * @param {{lines: Array<{itemId:string, quantity:number}>}} proposed
 * @returns {{valid: boolean, message?: string}}
 */
export const validateProposedCancellation = (order, proposed) => {
  const lines = proposed?.lines || [];
  if (!lines.length) {
    return { valid: false, message: 'Select at least one item to cancel.' };
  }

  const available = new Map(remainingCancellable(order).map((l) => [l.itemId, l.quantity]));
  const gone = goneQuantityByItem(order);
  const byItem = new Map((order?.items || []).map((i) => [idOf(i._id), i]));

  // Fold duplicates first: two entries for the same line each pass a per-entry check
  // while together exceeding the remainder.
  const requested = new Map();
  for (const line of lines) {
    const id = idOf(line.itemId);
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return { valid: false, message: 'Cancelled quantity must be a whole number of at least 1.' };
    }
    requested.set(id, (requested.get(id) || 0) + qty);
  }

  for (const [id, qty] of requested) {
    const item = byItem.get(id);
    if (!item) {
      return { valid: false, message: 'One of the selected lines is not on this order.' };
    }
    const canCancel = available.get(id) || 0;
    if (qty > canCancel) {
      const name = item.name || 'This item';
      if ((gone.get(id) || 0) > 0) {
        return {
          valid: false,
          message: `${name}: only ${canCancel} of ${item.quantity} can be cancelled — `
            + `${gone.get(id)} already shipped. Shipped goods have to come back as a return.`,
        };
      }
      return {
        valid: false,
        message: `${name}: only ${canCancel} left to cancel (you asked for ${qty}).`,
      };
    }
  }

  return { valid: true };
};

/**
 * Everything a UI needs to describe cancellation state, without inventing a status.
 *
 * @param {object} order
 * @returns {{orderedUnits:number, cancelledUnits:number, liveUnits:number,
 *   cancellationCount:number, fullyCancelled:boolean, partial:boolean, label:string|null}}
 */
export const cancellationSummary = (order) => {
  const items = order?.items || [];
  const cancelled = cancelledQuantityByItem(order);

  const orderedUnits = items.reduce((n, i) => n + (i.quantity || 0), 0);
  // Clamped per line: a cancellation recorded against a line whose quantity later
  // read differently must never make "cancelled" exceed "ordered" in the copy.
  const cancelledUnits = items.reduce(
    (n, i) => n + Math.min(i.quantity || 0, cancelled.get(idOf(i._id)) || 0), 0);
  const liveUnits = Math.max(0, orderedUnits - cancelledUnits);

  const fullyCancelled = isFullyCancelled(order);
  const partial = cancelledUnits > 0 && !fullyCancelled;

  let label = null;
  if (fullyCancelled) label = 'Cancelled';
  else if (partial) label = `${cancelledUnits} of ${orderedUnits} items cancelled`;

  return {
    orderedUnits,
    cancelledUnits,
    liveUnits,
    cancellationCount: (order?.cancellations || []).length,
    fullyCancelled,
    partial,
    label,
  };
};
