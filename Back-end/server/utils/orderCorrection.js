/**
 * Order corrections — which hand-corrections an order allows. Pure: no I/O.
 *
 * Orders handled on Google Chat before the team panel existed still read "In Stock"
 * or "Ordered From Supplier" here although they went out (and arrived) long ago.
 * Procurement brings them up to date with an explicit, logged correction
 * (services/orderCorrectionService.js). The rules here decide what is offered; the
 * service re-checks them against the order as it is at the moment of writing.
 *
 * Never money: a line waiting on a supplier payment, out of stock, in the refund
 * flow or cancelled is not correctable, and neither is a cancelled / returned order.
 */

import { STAGE, unshippedQuantity } from './teamWorkflow.js';
import { SHIPMENT_STATUS } from './orderFulfilment.js';

export const CORRECTION = Object.freeze({
  DISPATCHED: 'dispatched',   // pre-dispatch items → a parcel, in transit
  DELIVERED: 'delivered',     // pre-dispatch items → a parcel, delivered; and/or in-transit parcels → delivered
  PARCEL: 'parcel',           // courier / tracking / dates on any dispatched or delivered parcel
  BACK_TO_NEW: 'back_to_new', // In Stock / Our Warehouse / Ordered From Supplier → New Order
  UNDELIVER: 'undeliver',     // a delivered parcel → back in transit
});
export const CORRECTION_VALUES = Object.freeze(Object.values(CORRECTION));

export const MIN_REASON = 5;
export const MAX_REASON = 300;

/** Order statuses a correction may touch: paid and not cancelled or returned. */
const CORRECTABLE_ORDER = new Set(['processing', 'shipped', 'delivered']);

/** Lines that have not left yet and carry no money in flight. */
export const PRE_DISPATCH = new Set([STAGE.STOCK_CHECK, STAGE.TO_SHIP, STAGE.OWN_STOCK, STAGE.WITH_SUPPLIER]);
/** Lines whose stock decision can be taken back to "New Order". */
export const BACKABLE = new Set([STAGE.TO_SHIP, STAGE.OWN_STOCK, STAGE.WITH_SUPPLIER]);

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/**
 * What this order allows, from its workflow view. `null` when nothing is correctable.
 * @param {object} order - the order (lean), with shipments
 * @param {object} view - workflowView(order)
 */
export function correctionOptions(order, view) {
  if (!view || !CORRECTABLE_ORDER.has(order?.status) || order.paymentStatus !== 'paid') return null;
  const dispatchable = view.lines
    .filter((l) => PRE_DISPATCH.has(l.stage) && unshippedQuantity(order, l.itemId) > 0)
    .map((l) => l.itemId);
  const parcels = (order.shipments || [])
    .filter((s) => s.status === SHIPMENT_STATUS.SHIPPED || s.status === SHIPMENT_STATUS.DELIVERED)
    .map((s) => ({ id: idOf(s._id), status: s.status }));
  return {
    dispatch: order.status === 'delivered' ? [] : dispatchable,
    inTransit: parcels.filter((p) => p.status === SHIPMENT_STATUS.SHIPPED).map((p) => p.id),
    delivered: parcels.filter((p) => p.status === SHIPMENT_STATUS.DELIVERED).map((p) => p.id),
    parcels: parcels.map((p) => p.id),
    back: view.lines.filter((l) => BACKABLE.has(l.stage)).map((l) => l.itemId),
  };
}

/** Is anything at all correctable on this order? */
export const hasCorrections = (opts) =>
  !!opts && ['dispatch', 'inTransit', 'delivered', 'parcels', 'back'].some((k) => opts[k].length > 0);

const IST_NOON_UTC = 'T06:30:00.000Z'; // 12:00 in India

/**
 * A 'YYYY-MM-DD' (an Indian calendar day) as the moment to record: noon that day,
 * kept between `notBefore` and `now` so a same-day date never lands before the order
 * was paid or in the future. Returns null for an absent value; throws a message for
 * a bad one.
 */
export function correctionDate(day, { notBefore, now = new Date() } = {}) {
  if (day == null || day === '') return null;
  const s = String(day).trim();
  const at = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}${IST_NOON_UTC}`) : null;
  if (!at || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== s) throw new Error('Choose a valid date.');
  const today = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (s > today) throw new Error('The date can\'t be in the future.');
  if (notBefore) {
    const first = new Date(new Date(notBefore).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (s < first) throw new Error('The date can\'t be before the order was placed.');
  }
  const t = Math.min(Math.max(at.getTime(), notBefore ? new Date(notBefore).getTime() + 60_000 : 0), now.getTime());
  return new Date(t);
}
