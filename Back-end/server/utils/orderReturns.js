/**
 * Partial-return maths — has the customer sent back the WHOLE order, or part of it?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────
 * `Order.status = 'returned'` used to be set the moment operations approved any return
 * (orderRepository.markReturnedOnReturnApproval, compare-and-set on `delivered`). With
 * one return per order that was right. Per-line returns break it: a customer who sends
 * back 1 of 3 faulty items flipped the ENTIRE order to `returned` — and `returned` is a
 * terminal state in orderStatusService.STATUS_TRANSITIONS, so the other two items could
 * never be returned afterwards and the order could never move again.
 *
 * That directly defeated a decision already made elsewhere in the codebase: the
 * `unique_inflight_return_per_order_product` index was deliberately narrowed (see
 * models/ReturnRequest.js) precisely so that "a customer who sent back 1 of 3 faulty
 * items" could come back for the other 2. The index allowed it; the status flip then
 * slammed the door. This module is the missing predicate that keeps the two in step.
 *
 * ── WHY PRODUCT-KEYED, NOT ITEM-KEYED ─────────────────────────────────────────────
 * Shipments and cancellations key their lines on `Order.items[]._id`. Returns do NOT —
 * `ReturnRequest.items[]` keys on `product` (+ `variantId`), and the existing
 * `returnRequestRepository.returnedQuantityByProduct` aggregation groups by product.
 * Rather than stand up a second, rival aggregation keyed differently, this module folds
 * the ORDER side to the same product key so the two are directly comparable.
 *
 * Collapsing variants of one product together is safe HERE specifically because the
 * only question asked is "is every delivered unit accounted for?". Both sides of that
 * comparison are summed the same way, so the totals match whenever coverage is genuine.
 * A per-variant answer would be needed to price a refund — this module never does that.
 *
 * Pure functions only: no DB, no I/O. The caller supplies the returned-quantity map.
 */

import { deliveredQuantityByItem } from './orderFulfilment.js';
import { cancelledQuantityByItem } from './orderCancellation.js';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/**
 * Units of each PRODUCT on this order that have actually reached the customer.
 *
 * Live units only: anything cancelled before delivery is subtracted, because a
 * cancelled unit was never delivered and can never be returned. Requiring it here
 * would make `coversEveryDeliveredLine` permanently false for any partly cancelled
 * order, so a genuine full return of the remainder could never close the order.
 *
 * ⚠️ LEGACY ORDERS: an order with no parcels has no per-parcel delivery data, so
 * `deliveredQuantityByItem` is empty for it even though the order really was delivered.
 * For those we fall back to "every live unit is delivered", which is exactly what the
 * order-level status asserted before parcels existed. Without this fallback every
 * historical order would look 0%-delivered and so could never be marked returned.
 *
 * @param {object} order
 * @returns {Map<string, number>} productId → delivered units
 */
export const deliveredQuantityByProduct = (order) => {
  const items = order?.items || [];
  const hasParcels = Boolean((order?.shipments || []).length);
  const delivered = deliveredQuantityByItem(order);
  const cancelled = cancelledQuantityByItem(order);

  const totals = new Map();
  for (const item of items) {
    const productId = idOf(item.product);
    if (!productId) continue; // legacy WooCommerce line with no product ref

    const live = Math.max(0, (item.quantity || 0) - (cancelled.get(idOf(item._id)) || 0));
    const got = hasParcels
      ? Math.min(live, delivered.get(idOf(item._id)) || 0)
      : live;

    if (got > 0) totals.set(productId, (totals.get(productId) || 0) + got);
  }
  return totals;
};

/**
 * Has every delivered unit on this order been claimed by a return?
 *
 * @param {object} order
 * @param {Map<string, number>} returnedByProduct - productId → units already spoken
 *   for by a return, from returnRequestRepository.returnedQuantityByProduct. Only
 *   quantity-consuming statuses count (a rejected or withdrawn return frees its units),
 *   which that repository method already enforces.
 * @returns {boolean} true only when nothing delivered is still with the customer.
 *
 * ⚠️ Returns FALSE for an order with nothing delivered. "Vacuously covered" would let
 * an order that never arrived be marked `returned`, which is a different (and wrong)
 * statement about where the goods are.
 */
export const coversEveryDeliveredLine = (order, returnedByProduct) => {
  const delivered = deliveredQuantityByProduct(order);
  if (delivered.size === 0) return false;

  for (const [productId, qty] of delivered) {
    if ((returnedByProduct?.get(productId) || 0) < qty) return false;
  }
  return true;
};

/**
 * Units still with the customer — delivered, not cancelled, not yet returned.
 * What a "Partially returned · 1 of 3" label counts, and what a later return may claim.
 *
 * @param {object} order
 * @param {Map<string, number>} returnedByProduct
 * @returns {Array<{productId: string, name: string|null, quantity: number}>}
 */
export const remainingReturnable = (order, returnedByProduct) => {
  const delivered = deliveredQuantityByProduct(order);
  const nameFor = new Map(
    (order?.items || [])
      .filter((i) => idOf(i.product))
      .map((i) => [idOf(i.product), i.name || i.product?.name || null]),
  );

  const out = [];
  for (const [productId, qty] of delivered) {
    const left = qty - (returnedByProduct?.get(productId) || 0);
    if (left > 0) out.push({ productId, name: nameFor.get(productId) || null, quantity: left });
  }
  return out;
};

/**
 * Counts for the derived "Partially returned" label, on the same footing as
 * orderFulfilment.fulfilmentSummary — partiality is a DISPLAY fact, never a status
 * enum value. See the design note at the top of utils/orderFulfilment.js for why we
 * do not add `partially_returned` to Order.status.
 *
 * @param {object} order
 * @param {Map<string, number>} returnedByProduct
 * @returns {{deliveredUnits:number, returnedUnits:number, fullyReturned:boolean,
 *   partial:boolean, label:string|null}} label is null when nothing was returned.
 */
export const returnSummary = (order, returnedByProduct) => {
  const delivered = deliveredQuantityByProduct(order);
  const deliveredUnits = [...delivered.values()].reduce((n, q) => n + q, 0);

  // Clamped per product: a return can only ever cover units this order delivered, so an
  // over-claim (bad data, a return recorded against the wrong order) must not inflate
  // the count past the total and read "4 of 3 returned".
  let returnedUnits = 0;
  for (const [productId, qty] of delivered) {
    returnedUnits += Math.min(qty, returnedByProduct?.get(productId) || 0);
  }

  const fullyReturned = deliveredUnits > 0 && returnedUnits >= deliveredUnits;
  const partial = returnedUnits > 0 && !fullyReturned;

  let label = null;
  if (fullyReturned) label = 'Returned';
  else if (partial) label = `Partially returned · ${returnedUnits} of ${deliveredUnits} items`;

  return { deliveredUnits, returnedUnits, fullyReturned, partial, label };
};

export default {
  deliveredQuantityByProduct,
  coversEveryDeliveredLine,
  remainingReturnable,
  returnSummary,
};
