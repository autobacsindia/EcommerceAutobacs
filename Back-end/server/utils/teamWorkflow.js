/**
 * Team workflow — where each order line stands, derived, never stored.
 *
 * `Order.workflow` records only the TEAMS' decisions (stock check, the customer's
 * choice, accounts' approval). What physically happened lives where it always has:
 * `shipments[]` (what left, what arrived) and `cancellations[]` (what was cancelled
 * and refunded). A line's stage is computed from all three every time, so an admin
 * shipping or cancelling from the admin panel moves the team view along with no
 * extra write — the two panels cannot drift apart.
 *
 * Pure functions: no I/O.
 */

import { shippedQuantityByItem, deliveredQuantityByItem, SHIPMENT_STATUS } from './orderFulfilment.js';
import { cancelledQuantityByItem } from './orderCancellation.js';

export const STOCK = Object.freeze({
  PENDING: 'pending',
  IN_STOCK: 'in_stock',
  ORDERED: 'ordered',
  OUT_OF_STOCK: 'out_of_stock',
});

/** Every stage a line can be in, in the order the team works through them. */
export const STAGE = Object.freeze({
  STOCK_CHECK: 'stock_check',           // procurement: is it available?
  TO_SHIP: 'to_ship',                   // procurement: in stock — order it / upload proof
  PAYMENT_PENDING: 'payment_pending',   // supplier payment raised, waiting for accounts / admin to pay
  WITH_SUPPLIER: 'with_supplier',       // procurement: ordered, waiting for the supplier's proof
  CUSTOMER_DECISION: 'customer_decision', // sales: out of stock — wait or refund?
  ACCOUNTS_APPROVAL: 'accounts_approval', // accounts: approve the refund
  SHIPPED: 'shipped',                   // in transit (operations follows up)
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',               // refunded / cancelled
});

export const STAGE_LABELS = Object.freeze({
  [STAGE.STOCK_CHECK]: 'New Order',
  [STAGE.TO_SHIP]: 'In Stock',
  [STAGE.PAYMENT_PENDING]: 'Payment Pending',
  [STAGE.WITH_SUPPLIER]: 'Ordered From Supplier',
  [STAGE.CUSTOMER_DECISION]: 'Out of stock — ask customer',
  [STAGE.ACCOUNTS_APPROVAL]: 'Refund — waiting for accounts',
  [STAGE.SHIPPED]: 'Dispatched',
  [STAGE.DELIVERED]: 'Delivered',
  [STAGE.CANCELLED]: 'Cancelled / refunded',
});

/** Which team's queue each open stage lands in. */
export const STAGE_TEAM = Object.freeze({
  [STAGE.STOCK_CHECK]: 'procurement',
  [STAGE.TO_SHIP]: 'procurement',
  // Accounts approves and the admin pays, but procurement follows it up with them.
  [STAGE.PAYMENT_PENDING]: 'procurement',
  [STAGE.WITH_SUPPLIER]: 'procurement',
  [STAGE.CUSTOMER_DECISION]: 'sales',
  [STAGE.ACCOUNTS_APPROVAL]: 'accounts',
});

/** Order states after which no team has anything left to do. */
const FINISHED_ORDER_STATUSES = new Set(['cancelled', 'returned', 'delivered']);

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** A fresh workflow for an order that has just been paid: every line awaits a stock check. */
export const initialWorkflow = (order, now = new Date()) => ({
  enteredAt: now,
  open: true,
  lines: (order?.items || []).map((item) => ({ itemId: item._id, stock: STOCK.PENDING })),
  history: [{ at: now, action: 'entered', note: 'Paid — waiting for a stock check' }],
});

/**
 * The stage of one workflow line.
 *
 * Physical facts win over team decisions: a line that has been cancelled, delivered or
 * shipped is in that stage whatever the stock check said, because that is what the
 * customer actually has. Only units still owed are steered by the workflow.
 */
export function lineStage(order, wfLine, quantities = null) {
  const q = quantities || {
    shipped: shippedQuantityByItem(order),
    delivered: deliveredQuantityByItem(order),
    cancelled: cancelledQuantityByItem(order),
  };
  const id = idOf(wfLine.itemId);
  const item = (order?.items || []).find((i) => idOf(i._id) === id);
  const ordered = item?.quantity || 0;
  const live = ordered - (q.cancelled.get(id) || 0);

  if (live <= 0) return STAGE.CANCELLED;
  const committed = q.shipped.get(id) || 0;
  if (committed >= live) {
    return (q.delivered.get(id) || 0) >= live ? STAGE.DELIVERED : STAGE.SHIPPED;
  }

  // A supplier payment raised and not yet paid (paymentRequestService sets and
  // clears this). Once paid, the line is ordered from that supplier.
  if (wfLine.supplierPaymentAt && wfLine.stock !== STOCK.OUT_OF_STOCK) return STAGE.PAYMENT_PENDING;

  switch (wfLine.stock) {
    case STOCK.IN_STOCK: return STAGE.TO_SHIP;
    case STOCK.ORDERED: return STAGE.WITH_SUPPLIER;
    case STOCK.OUT_OF_STOCK:
      if (!wfLine.refundRequestedAt) return STAGE.CUSTOMER_DECISION;
      // Approval claimed: the cancellation is being recorded (or failed and will be
      // released). Either way it is still accounts' line until it resolves.
      return STAGE.ACCOUNTS_APPROVAL;
    default:
      return STAGE.STOCK_CHECK;
  }
}

/** Units of a line still owed and not yet in a parcel — what a proof upload would ship. */
export function unshippedQuantity(order, itemId) {
  const id = idOf(itemId);
  const item = (order?.items || []).find((i) => idOf(i._id) === id);
  if (!item) return 0;
  const shipped = shippedQuantityByItem(order).get(id) || 0;
  const cancelled = cancelledQuantityByItem(order).get(id) || 0;
  return Math.max(0, (item.quantity || 0) - shipped - cancelled);
}

/**
 * Every line with its stage, plus the order-level picture: which teams still have
 * work, and whether the order belongs in the open queue at all.
 */
export function workflowView(order) {
  const wf = order?.workflow;
  if (!wf?.enteredAt) return null;

  const quantities = {
    shipped: shippedQuantityByItem(order),
    delivered: deliveredQuantityByItem(order),
    cancelled: cancelledQuantityByItem(order),
  };
  const finished = FINISHED_ORDER_STATUSES.has(order.status);

  const lines = (wf.lines || []).map((l) => {
    let stage = lineStage(order, l, quantities);
    if (finished) {
      // A finished order has no open work. A whole-order cancel/return predates or
      // bypasses per-line records, so its lines read as cancelled; a delivered order
      // keeps genuinely cancelled lines, and everything else on it was delivered —
      // including legacy orders marked delivered with no parcels at all.
      if (order.status !== 'delivered') stage = STAGE.CANCELLED;
      else if (stage !== STAGE.CANCELLED) stage = STAGE.DELIVERED;
    }
    return { ...l, itemId: idOf(l.itemId), stage, stageLabel: STAGE_LABELS[stage] };
  });

  const inTransit = finished ? [] : (order.shipments || []).filter((s) => s.status === SHIPMENT_STATUS.SHIPPED);

  const needs = new Set();
  for (const l of lines) {
    const team = STAGE_TEAM[l.stage];
    if (team) needs.add(team);
  }
  if (inTransit.length) needs.add('operations');

  return {
    lines,
    needs: [...needs],
    inTransitShipmentIds: inTransit.map((s) => idOf(s._id)),
    open: needs.size > 0,
    summary: summarise(lines, inTransit.length),
    summaryStage: summaryStage(lines, inTransit.length).stage,
  };
}

/** One short phrase for a list row: the most urgent thing about the order. */
/** The stage that best describes the whole order — what its one pill shows (and is coloured by). */
function summaryStage(lines, inTransit) {
  const order = [
    STAGE.STOCK_CHECK, STAGE.CUSTOMER_DECISION, STAGE.ACCOUNTS_APPROVAL,
    STAGE.TO_SHIP, STAGE.PAYMENT_PENDING, STAGE.WITH_SUPPLIER,
  ];
  for (const stage of order) {
    const n = lines.filter((l) => l.stage === stage).length;
    if (n) return { stage, n };
  }
  if (inTransit) return { stage: STAGE.SHIPPED };
  if (lines.length && lines.every((l) => l.stage === STAGE.CANCELLED)) return { stage: STAGE.CANCELLED };
  if (lines.some((l) => l.stage === STAGE.DELIVERED)) return { stage: STAGE.DELIVERED };
  return { stage: STAGE.SHIPPED };
}

function summarise(lines, inTransit) {
  const { stage, n } = summaryStage(lines, inTransit);
  return n && lines.length > 1 ? `${STAGE_LABELS[stage]} (${n} of ${lines.length})` : STAGE_LABELS[stage];
}
