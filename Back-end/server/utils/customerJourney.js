/**
 * Where an order stands FOR THE CUSTOMER — the five steps they see on their order
 * page and are emailed about ("Nothing Extra", Herald, 2026-11-23: "customers know
 * where their order is at every stage, without having to ask").
 *
 *   placed → preparing → packed → shipped → delivered
 *
 * Every step is READ OFF REAL STATE, never a timer:
 *   placed     the order was paid (paidAt; workflow.enteredAt; createdAt for legacy).
 *   preparing  procurement made a stock decision that moves the item forward
 *              (in stock / our warehouse / ordered from supplier / supplier payment
 *              raised) — the first such Order.workflow.history entry — or a parcel
 *              exists (an admin-only order packed without the team workflow).
 *   packed     a live parcel exists (Order.shipments[], created packed or shipped).
 *   shipped    a live parcel was handed to the courier (shippedAt) — the courier and
 *              AWB are on it. "Courier booked" before pickup is a packed parcel that
 *              already carries an AWB.
 *   delivered  the order is delivered.
 *
 * Pure, no I/O, no imports: the notification rules (orderNotificationRules.js) load
 * it, and that module must stay free of mail/queue dependencies.
 *
 * What it never exposes: staff names, suppliers, notes. The customer order API only
 * returns what this builds (dates + step keys), never the workflow it reads.
 */

export const STEP = Object.freeze({
  PLACED: 'placed',
  PREPARING: 'preparing',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
});

export const STEPS = Object.freeze([STEP.PLACED, STEP.PREPARING, STEP.PACKED, STEP.SHIPPED, STEP.DELIVERED]);

/** Workflow actions that mean "we have the item / have ordered it" — real preparation. */
export const PREPARING_ACTIONS = Object.freeze(new Set([
  'stock_in_stock', 'stock_own_stock', 'stock_ordered', 'payment_pending',
]));

/** Steps before the courier has the parcel — the only ones a "still on it" note covers. */
export const PRE_DISPATCH = Object.freeze(new Set([STEP.PLACED, STEP.PREPARING, STEP.PACKED]));

/** Order statuses the journey is shown (and messaged) for. */
const LIVE_STATUSES = new Set(['processing', 'shipped', 'delivered']);

const time = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** When a subdocument was created: its ObjectId carries the second it was made. */
export const createdTimeOf = (doc) => {
  const id = doc?._id;
  if (!id) return null;
  if (typeof id.getTimestamp === 'function') return id.getTimestamp().getTime();
  const hex = String(id);
  return /^[0-9a-f]{24}$/i.test(hex) ? parseInt(hex.slice(0, 8), 16) * 1000 : null;
};

const minOf = (values) => {
  const real = values.filter((v) => v != null);
  return real.length ? Math.min(...real) : null;
};

const liveParcels = (order) => (order?.shipments || []).filter((s) => s && s.status !== 'lost');

/**
 * A stock answer is still pending a CUSTOMER decision (out of stock: wait or refund?)
 * or a refund approval. Sales is talking to the customer about it; an automatic "still
 * on it" note would talk over them.
 */
export function hasOpenStockIssue(order) {
  return (order?.workflow?.lines || []).some((l) => l?.stock === 'out_of_stock');
}

/**
 * The customer's journey for one order, or null when there is none to show (unpaid,
 * cancelled, returned).
 *
 * @param {object} order - needs status, paidAt/createdAt, workflow, shipments, deliveredAt
 * @returns {null | {
 *   current: string,                        // the step being worked on now (or 'delivered')
 *   steps: Array<{ key: string, at: Date|null, done: boolean }>,
 *   stepStartedAt: Date|null,               // when the current step began (last done step)
 *   parcels: { total: number, shipped: number, delivered: number },
 *   onHold: boolean,                        // an item is out of stock and we are asking the customer
 * }}
 */
export function customerJourney(order) {
  if (!order || !LIVE_STATUSES.has(order.status)) return null;

  const parcels = liveParcels(order);
  const placedAt = time(order.paidAt) ?? time(order.workflow?.enteredAt) ?? time(order.createdAt);

  const preparedByTeam = minOf((order.workflow?.history || [])
    .filter((h) => PREPARING_ACTIONS.has(h?.action))
    .map((h) => time(h.at)));
  const firstParcelAt = minOf(parcels.map((s) => minOf([createdTimeOf(s), time(s.shippedAt)])));
  const shippedAt = minOf(parcels
    .filter((s) => s.status === 'shipped' || s.status === 'delivered')
    .map((s) => time(s.shippedAt) ?? createdTimeOf(s)));
  const delivered = order.status === 'delivered';
  const lastParcelDelivery = parcels.reduce((max, s) => Math.max(max, time(s.deliveredAt) || 0), 0) || null;
  const deliveredAt = delivered ? (time(order.deliveredAt) ?? lastParcelDelivery) : null;

  // A later step implies the earlier ones happened: a parcel means it was prepared, a
  // delivery means it shipped. Each step's date is its own, or the next step's date
  // when it was never recorded on its own (an admin who shipped straight away).
  const raw = {
    [STEP.PLACED]: placedAt,
    [STEP.PREPARING]: preparedByTeam ?? firstParcelAt,
    [STEP.PACKED]: firstParcelAt,
    [STEP.SHIPPED]: shippedAt,
    [STEP.DELIVERED]: deliveredAt,
  };
  const reached = {
    [STEP.PLACED]: true,
    [STEP.PREPARING]: raw[STEP.PREPARING] != null || shippedAt != null || delivered,
    [STEP.PACKED]: parcels.length > 0 || delivered,
    [STEP.SHIPPED]: shippedAt != null || delivered,
    [STEP.DELIVERED]: delivered,
  };
  // Legacy orders (no workflow, status already shipped with no parcel rows).
  if (order.status === 'shipped') {
    reached[STEP.PREPARING] = true;
    reached[STEP.PACKED] = true;
    reached[STEP.SHIPPED] = true;
  }

  let fill = null;
  const steps = [...STEPS].reverse().map((key) => {
    const done = reached[key];
    const at = done ? (raw[key] ?? fill) : null;
    if (done && at != null) fill = at;
    return { key, at: at != null ? new Date(at) : null, done };
  }).reverse();

  const lastDone = [...steps].reverse().find((s) => s.done);
  const current = delivered ? STEP.DELIVERED : (steps.find((s) => !s.done)?.key || STEP.DELIVERED);

  return {
    current,
    steps,
    stepStartedAt: lastDone?.at || null,
    parcels: {
      total: parcels.length,
      shipped: parcels.filter((s) => s.status === 'shipped' || s.status === 'delivered').length,
      delivered: parcels.filter((s) => s.status === 'delivered').length,
    },
    onHold: !delivered && hasOpenStockIssue(order),
  };
}

/**
 * The step a "still on it" reassurance would be about: the step we are working on
 * when nothing has left the building yet, else null. `placed`'s work is the stock
 * check, `preparing`'s is getting it packed, `packed`'s is the courier pickup.
 */
export function reassuranceStage(journey) {
  if (!journey || journey.onHold || journey.parcels.shipped > 0) return null;
  const lastDone = [...journey.steps].reverse().find((s) => s.done);
  return lastDone && PRE_DISPATCH.has(lastDone.key) ? lastDone.key : null;
}

export default { STEP, STEPS, PREPARING_ACTIONS, PRE_DISPATCH, customerJourney, reassuranceStage, hasOpenStockIssue, createdTimeOf };
