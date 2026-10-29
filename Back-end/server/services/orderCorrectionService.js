/**
 * "Edit order" — procurement (and the admin) correct an order by hand.
 *
 * Many orders were handled on Google Chat before the team panel existed, so the panel
 * still shows them "In Stock" or "Ordered From Supplier" although they went out long
 * ago. A correction brings one up to date:
 *
 *   dispatched  : chosen items → one parcel, in transit (courier, tracking, date optional; no photo)
 *   delivered   : chosen items → one parcel, delivered; and/or parcels in transit → delivered
 *   parcel      : courier / tracking / dispatch and delivery dates on any parcel, even a delivered one
 *   back_to_new : In Stock / Our Warehouse / Ordered From Supplier → New Order
 *   undeliver   : a delivered parcel → back in transit
 *
 * ── WHAT MAKES IT SAFE ──────────────────────────────────────────────────────────
 *   • Explicit and logged: a reason is required; one workflow-history entry carries
 *     what changed, the reason and the person's name, and the audit log records it.
 *   • Compare-and-set: the caller sends the stage of every line (and status of every
 *     parcel) it saw; anything different is a 409, so two people correcting at once,
 *     or a correction racing a normal step, cannot both win. The writes underneath are
 *     the same compare-and-sets every other team action uses.
 *   • The same records: parcels are created and delivered by shipmentService, exactly
 *     as an admin would, so the order status roll-up, loyalty points, the gift and
 *     the return window all follow. Only the customer emails, the review request and
 *     the team-chat posts are left out — the customer received these orders long ago.
 *   • Never money: no payment status, amount, refund or supplier-payment record is
 *     written. Lines with a supplier payment in flight, out of stock or in the refund
 *     flow are not correctable, and a line whose supplier was PAID cannot go back to
 *     "New Order" (it would invite paying the supplier twice).
 */

import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import shipmentService from './shipmentService.js';
import { assertNoPendingSupplierPayment } from './paymentRequestService.js';
import { can, canView, event, refreshOpen, getOrder } from './teamWorkflowService.js';
import { workflowView, STOCK, STAGE_LABELS, unshippedQuantity } from '../utils/teamWorkflow.js';
import { SHIPMENT_STATUS, rewardShipped } from '../utils/orderFulfilment.js';
import { owesGoodie, variantDisplayName } from '../utils/orderLines.js';
import {
  CORRECTION, CORRECTION_VALUES, MIN_REASON, MAX_REASON, PRE_DISPATCH, BACKABLE,
  correctionOptions, correctionDate,
} from '../utils/orderCorrection.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const CHANGED = 'This order was changed by someone else just now. Refresh it and try again.';
/** Supplier payments that no longer hold anything: they never moved money. */
const DEAD_PAYMENT = new Set(['declined', 'cancelled']);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const dayLabel = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function asDate(day, order) {
  try {
    return correctionDate(day, { notBefore: order.createdAt });
  } catch (err) {
    throw fail(err.message, 400);
  }
}

/** The lines the caller chose, each still in the stage the caller saw and allowed for this action. */
function chosenLines(view, itemIds, expected, allowed) {
  const wanted = [...new Set((itemIds || []).map(String))];
  return wanted.map((id) => {
    const line = view.lines.find((l) => l.itemId === id);
    if (!line) throw fail('That item is not on this order.', 404);
    if (expected?.[id] !== line.stage) throw fail(CHANGED, 409);
    if (!allowed.has(line.stage)) throw fail(`"${STAGE_LABELS[line.stage]}" items can't be corrected this way.`, 409);
    return line;
  });
}

/** Parcels the caller chose, each still in the status the caller saw. */
function chosenParcels(order, shipmentIds, expected, status) {
  return [...new Set((shipmentIds || []).map(String))].map((id) => {
    const parcel = (order.shipments || []).find((s) => idOf(s._id) === id);
    if (!parcel) throw fail('Parcel not found on this order.', 404);
    if (expected?.[id] !== parcel.status) throw fail(CHANGED, 409);
    if (status && parcel.status !== status) throw fail(`Parcel ${parcel.sequence} is not ${status === SHIPMENT_STATUS.SHIPPED ? 'in transit' : 'delivered'}.`, 409);
    return parcel;
  });
}

/** One parcel with every unit still owed on these lines, recorded without telling the customer. */
async function recordParcel(actor, order, lines, { courier, tracking, shippedAt, includesGift }) {
  const payload = {
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: unshippedQuantity(order, l.itemId) })).filter((l) => l.quantity > 0),
    trackingNumber: tracking || undefined,
    carrier: courier ? { name: courier } : undefined,
    shippedAt: shippedAt || undefined,
    notes: `Recorded by hand in the team panel by ${actor.name} (order correction)`,
    // The gift question only exists while one is owed and not yet in a parcel.
    ...(owesGoodie(order) && !rewardShipped(order) && { includesReward: includesGift !== false }),
  };
  if (!payload.lines.length) throw fail('Nothing on this order is left to dispatch.', 409);
  // A supplier payment still awaiting approval or payment: money is in flight — sort it out first.
  await assertNoPendingSupplierPayment(idOf(order._id), payload.lines.map((l) => l.itemId));
  const result = await shipmentService.createShipment(idOf(order._id), payload, { userId: actor._id, notify: false });
  if (!result.success) throw fail(result.message || 'Could not record the dispatch.', 409);
  return result.shipment;
}

async function deliverParcel(actor, orderId, parcel, deliveredAt) {
  const r = await shipmentService.markShipmentDelivered(orderId, idOf(parcel._id), {
    userId: actor._id, deliveredAt: deliveredAt || undefined, notify: false,
  });
  if (!r.success) throw fail(r.message, 409);
}

/**
 * Apply one correction. Returns the refreshed order for the panel.
 * @param {object} input - { action, reason, itemIds?, expectedStages?, shipmentIds?,
 *   expectedParcels?, courierName?, trackingNumber?, shippedOn?, deliveredOn?, includesGift? }
 */
export async function correctOrder(actor, orderId, input = {}, req) {
  if (!can.procurement(actor)) throw fail('Only the procurement team can edit orders.', 403);
  const { action } = input;
  if (!CORRECTION_VALUES.includes(action)) throw fail('Choose what to correct.', 400);
  const reason = clean(input.reason, MAX_REASON);
  if (reason.length < MIN_REASON) throw fail('Say briefly why (for example "Sent via Google Chat on 3 March").', 400);

  const order = await orderRepository.findForWorkflow(orderId);
  if (!order?.workflow?.enteredAt || !canView(actor, order)) throw fail('Order not found in the team workflow.', 404);
  const view = workflowView(order);
  if (!correctionOptions(order, view)) {
    throw fail('This order can\'t be edited — it is cancelled, returned, or not paid.', 409);
  }

  const names = new Map((order.items || []).map((it) => [idOf(it._id), variantDisplayName(it.name, it.variantLabel)]));
  const itemList = (lines) => lines.map((l) => names.get(l.itemId) || 'Item').join(', ');
  const courier = clean(input.courierName, 80);
  const tracking = clean(input.trackingNumber, 80);
  const done = []; // what actually happened, for the history line
  const audit = { change: 'team_correction', action, reason };

  try {
    switch (action) {
      case CORRECTION.DISPATCHED: {
        const lines = chosenLines(view, input.itemIds, input.expectedStages, PRE_DISPATCH);
        if (!lines.length) throw fail('Choose the items that were dispatched.', 400);
        const shippedAt = asDate(input.shippedOn, order);
        const parcel = await recordParcel(actor, order, lines, { courier, tracking, shippedAt, includesGift: input.includesGift });
        done.push(`Marked dispatched: ${itemList(lines)}`, [courier, tracking].filter(Boolean).join(' '), shippedAt && `on ${dayLabel(shippedAt)}`);
        Object.assign(audit, { itemIds: lines.map((l) => l.itemId), shipmentId: idOf(parcel._id) });
        break;
      }

      case CORRECTION.DELIVERED: {
        const lines = chosenLines(view, input.itemIds, input.expectedStages, PRE_DISPATCH);
        const parcels = chosenParcels(order, input.shipmentIds, input.expectedParcels, SHIPMENT_STATUS.SHIPPED);
        if (!lines.length && !parcels.length) throw fail('Choose the items or parcels that were delivered.', 400);
        const deliveredAt = asDate(input.deliveredOn, order);
        const shippedAt = asDate(input.shippedOn, order);
        if (shippedAt && deliveredAt && shippedAt > deliveredAt) throw fail('The delivery date can\'t be before the dispatch date.', 400);
        if (deliveredAt) {
          const early = parcels.find((p) => p.shippedAt && new Date(p.shippedAt) > deliveredAt);
          if (early) throw fail(`Parcel ${early.sequence} was dispatched after that delivery date.`, 400);
        }
        const toDeliver = [...parcels];
        if (lines.length) {
          const parcel = await recordParcel(actor, order, lines, {
            courier, tracking, shippedAt: shippedAt || deliveredAt, includesGift: input.includesGift,
          });
          const sent = shippedAt || deliveredAt;
          done.push(`Marked dispatched: ${itemList(lines)}`, [courier, tracking].filter(Boolean).join(' '), sent && `on ${dayLabel(sent)}`);
          toDeliver.push(parcel);
          audit.itemIds = lines.map((l) => l.itemId);
        }
        audit.shipmentIds = toDeliver.map((p) => idOf(p._id));
        for (const p of toDeliver) {
          await deliverParcel(actor, orderId, p, deliveredAt);
          done.push(`Parcel ${p.sequence} marked delivered${deliveredAt ? ` on ${dayLabel(deliveredAt)}` : ''}`);
        }
        break;
      }

      case CORRECTION.PARCEL: {
        const [parcel] = chosenParcels(order, [input.shipmentIds?.[0]].filter(Boolean), input.expectedParcels);
        if (!parcel) throw fail('Choose the parcel to correct.', 400);
        if (![SHIPMENT_STATUS.SHIPPED, SHIPMENT_STATUS.DELIVERED].includes(parcel.status)) throw fail('Only a dispatched parcel can be corrected.', 409);
        const set = {};
        const changes = [];
        if (input.courierName != null && courier !== (parcel.carrier?.name || '')) {
          set['shipments.$.carrier.name'] = courier; changes.push(`courier ${courier || '—'}`);
        }
        if (input.trackingNumber != null && tracking !== (parcel.trackingNumber || '')) {
          set['shipments.$.trackingNumber'] = tracking; changes.push(`tracking ${tracking || '—'}`);
        }
        const shippedAt = asDate(input.shippedOn, order);
        const deliveredAt = parcel.status === SHIPMENT_STATUS.DELIVERED ? asDate(input.deliveredOn, order) : null;
        const ship = shippedAt || (parcel.shippedAt && new Date(parcel.shippedAt));
        const land = deliveredAt || (parcel.deliveredAt && new Date(parcel.deliveredAt));
        if (ship && land && ship > land) throw fail('The delivery date can\'t be before the dispatch date.', 400);
        if (shippedAt) { set['shipments.$.shippedAt'] = shippedAt; changes.push(`dispatched ${dayLabel(shippedAt)}`); }
        if (deliveredAt) { set['shipments.$.deliveredAt'] = deliveredAt; changes.push(`delivered ${dayLabel(deliveredAt)}`); }
        // The first parcel's tracking is mirrored onto the order (customer tracking, order emails).
        if (parcel.sequence === 1) {
          if ('shipments.$.carrier.name' in set) set['carrier.name'] = courier;
          if ('shipments.$.trackingNumber' in set) set.trackingNumber = tracking;
        }
        // A delivered order is dated by its last parcel to arrive.
        if (deliveredAt && order.status === 'delivered') {
          const latest = (order.shipments || [])
            .filter((s) => s.status === SHIPMENT_STATUS.DELIVERED)
            .map((s) => (idOf(s._id) === idOf(parcel._id) ? deliveredAt : new Date(s.deliveredAt || 0)))
            .reduce((a, b) => (b > a ? b : a));
          set.deliveredAt = latest;
          set['fulfillmentMetrics.deliveredAt'] = latest;
        }
        if (!changes.length) throw fail('Nothing was changed.', 400);
        const updated = await orderRepository.updateShipmentIf(orderId, idOf(parcel._id), { status: parcel.status }, set, null);
        if (!updated) throw fail(CHANGED, 409);
        done.push(`Parcel ${parcel.sequence}: ${changes.join(', ')}`);
        audit.shipmentId = idOf(parcel._id);
        audit.fields = changes;
        break;
      }

      case CORRECTION.BACK_TO_NEW: {
        const lines = chosenLines(view, input.itemIds, input.expectedStages, BACKABLE);
        if (!lines.length) throw fail('Choose the items to move back.', 400);
        // Any supplier payment for the item that is open (money in flight) or paid
        // (a "New Order" would invite paying again) keeps it where it is.
        const requests = await paymentRequestRepository.findForOrder(orderId);
        for (const l of lines) {
          const r = requests.find((x) => !DEAD_PAYMENT.has(x.status) && (x.itemIds || []).some((i) => idOf(i) === l.itemId));
          if (r) throw fail(`"${names.get(l.itemId)}" has supplier payment ${r.number} (${r.status}) — it can't go back to New Order.`, 409);
        }
        for (const l of lines) {
          const updated = await orderRepository.updateWorkflowLineIf(
            orderId, l.itemId,
            { stock: l.stock, supplierPaymentAt: null, refundRequestedAt: null },
            { set: { stock: STOCK.PENDING }, unset: ['stockBy', 'stockAt', 'supplierName', 'paymentInitiatedBy', 'paymentInitiatedAt'] },
            null,
          );
          if (!updated) throw fail(CHANGED, 409);
          done.push(`${names.get(l.itemId)}: ${STAGE_LABELS[l.stage]} → New Order`);
        }
        audit.itemIds = lines.map((l) => l.itemId);
        break;
      }

      case CORRECTION.UNDELIVER: {
        const [parcel] = chosenParcels(order, [input.shipmentIds?.[0]].filter(Boolean), input.expectedParcels, SHIPMENT_STATUS.DELIVERED);
        if (!parcel) throw fail('Choose the parcel.', 400);
        const r = await shipmentService.undoShipmentDelivered(orderId, idOf(parcel._id), { userId: actor._id });
        if (!r.success) throw fail(r.message, 409);
        done.push(`Parcel ${parcel.sequence}: Delivered → Dispatched`);
        audit.shipmentId = idOf(parcel._id);
        break;
      }

      default:
        throw fail('Choose what to correct.', 400);
    }
  } finally {
    // Whatever landed is recorded, even when a later step of the same correction failed
    // (a parcel recorded, then its delivery refused): history never under-reports.
    if (done.length) {
      const note = `${done.filter(Boolean).join(' · ')} — Reason: ${reason}`;
      auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { ...audit, note });
      try {
        await orderRepository.pushWorkflowEvent(orderId, event(actor, 'corrected', { note }));
        await refreshOpen(orderId);
      } catch (err) {
        // The correction itself landed and is in the audit log; do not mask its result.
        console.error(`[OrderCorrection] could not record history on ${orderId}:`, err.message);
      }
    }
  }
  return getOrder(actor, orderId);
}

export { MIN_REASON, MAX_REASON };
