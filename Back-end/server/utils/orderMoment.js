/**
 * The ONE picture the customer sees at the top of their order ("order moments",
 * owner-approved designs 2026-11-26). GET /orders/:id → `moment`.
 *
 * The scene is chosen HERE, from server-confirmed state only — the page never moves
 * a picture forward on its own (CLAUDE.md: money and order state are never
 * optimistic). First match wins:
 *
 *   payment_failed  unpaid order whose payment failed or expired
 *   refunded        the order-level refund is completed (or the order is marked refunded)
 *   cancelled       the order is cancelled; `refundDue` when it had been paid
 *   returning       a return is moving (raised, accepted, pickup booked, received)
 *   delivered       the last step is done
 *   on_hold         an item is out of stock and we are asking the customer
 *   delivery_failed the newest update on a parcel in transit is the team's
 *   out_for_delivery  "Delivery failed" / "Out for delivery" step (with its note)
 *   late            today (India) is past the date we promised — the courier's date
 *                   or the end of the 7–10 / 10–15 day window the page shows
 *   date_moved      the newest parcel update is the team moving its expected date
 *   in_transit      the newest parcel update is "Picked up" / "In transit" (+ note)
 *   partly          some parcels shipped, not all
 *   shipped | packed | preparing | placed   the last step that is done
 *
 * "Late" is measured against the promise the customer was shown, never against an
 * internal SLA: a "sorry, it's late" on day 3 of a 7–10 day window would alarm a
 * customer whose order is on time. There is no "new date" — nothing on the order
 * holds a revised promise, and inventing one would be worse than saying we're on it.
 *
 * Delivery updates come from what operations records on a parcel in transit
 * (`shipments[].trackingSteps`: status, note, time — the same three fields the
 * customer already sees under the parcel, utils/shipmentView.js) and from a change
 * of its expected day (`shipments[].etaHistory`, the day customerOrderProgress
 * already shows as the courier estimate). Only the step, its note, the new day and
 * the time leave here — never who recorded it, never an overdue reason.
 *
 * Pure, no I/O.
 */
import { STEPS } from './customerJourney.js';
import { PARCEL_STEP } from './parcelSteps.js';

export const MOMENT = Object.freeze({
  PAYMENT_FAILED: 'payment_failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  RETURNING: 'returning',
  DELIVERED: 'delivered',
  ON_HOLD: 'on_hold',
  DELIVERY_FAILED: 'delivery_failed',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  LATE: 'late',
  DATE_MOVED: 'date_moved',
  IN_TRANSIT: 'in_transit',
  PARTLY: 'partly',
  SHIPPED: 'shipped',
  PACKED: 'packed',
  PREPARING: 'preparing',
  PLACED: 'placed',
});

/**
 * Return statuses that are still moving, as the customer's step:
 * 0 requested → 1 pickup → 2 received (→ 3 refunded is the refund, not a return state).
 * New returns (ReturnRequest collection) and the legacy order.returnRequest share it.
 */
export const RETURN_STEP = Object.freeze({
  pending: 0,
  approved: 1,
  courier_booked: 1,
  received: 2,
  item_received: 2, // legacy order.returnRequest
});

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The India calendar day of `ms`, 'YYYY-MM-DD'. */
export const istDay = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The India day `days` after `fromMs`, pushed past a Sunday — the same rule the page
 * uses to print the window (Front-end/web/src/lib/deliveryWindow.ts istDayPlus), so the
 * date we call "late" is exactly the date the customer was shown.
 */
export function istDayPlus(fromMs, days) {
  const d = new Date(`${istDay(fromMs)}T00:00:00Z`).getTime() + days * DAY_MS;
  const day = new Date(d);
  return (day.getUTCDay() === 0 ? new Date(d + DAY_MS) : day).toISOString().slice(0, 10);
}

/** The last day we promised, 'YYYY-MM-DD', or null when no promise is on the page. */
export function promisedDay(estimate) {
  if (!estimate) return null;
  if (estimate.kind === 'courier') return DAY_RE.test(String(estimate.day || '')) ? estimate.day : null;
  if (estimate.kind === 'window') {
    const from = Date.parse(estimate.from);
    return Number.isFinite(from) && Number.isFinite(estimate.maxDays) ? istDayPlus(from, estimate.maxDays) : null;
  }
  return null;
}

/** Team steps on a parcel in transit → the moment they show. */
const STEP_MOMENT = Object.freeze({
  [PARCEL_STEP.PICKED_UP]: MOMENT.IN_TRANSIT,
  [PARCEL_STEP.IN_TRANSIT]: MOMENT.IN_TRANSIT,
  [PARCEL_STEP.OUT_FOR_DELIVERY]: MOMENT.OUT_FOR_DELIVERY,
  [PARCEL_STEP.DELIVERY_FAILED]: MOMENT.DELIVERY_FAILED,
});
const NOTE_MAX = 120;

const timeOf = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * The newest thing the team recorded on a parcel still in transit, or null:
 *   { key: in_transit | out_for_delivery | delivery_failed, note?, at }
 *   { key: date_moved, newDay, at }   — a real change (it had a day before)
 */
export function latestParcelUpdate(order) {
  let best = null;
  const offer = (at, update) => {
    if (at != null && (!best || at > best.t)) best = { t: at, update };
  };
  for (const s of order?.shipments || []) {
    if (s?.status !== 'shipped') continue;
    for (const step of s.trackingSteps || []) {
      const key = STEP_MOMENT[step?.status];
      if (!key) continue;
      const note = typeof step.note === 'string' ? step.note.trim().slice(0, NOTE_MAX) : '';
      offer(timeOf(step.at), { key, ...(note && { note }) });
    }
    for (const h of s.etaHistory || []) {
      if (!h?.from || !DAY_RE.test(String(h.to || '')) || h.from === h.to) continue;
      offer(timeOf(h.at), { key: MOMENT.DATE_MOVED, newDay: h.to });
    }
  }
  return best ? { ...best.update, at: new Date(best.t).toISOString() } : null;
}

/** The furthest-along moving return, as a step (0–2), or null. */
function returnStep(order, returns) {
  const statuses = (returns || []).map((r) => r?.status);
  if (order.returnRequest?.requestedAt) statuses.push(order.returnRequest.status);
  const steps = statuses.map((s) => RETURN_STEP[s]).filter((n) => n != null);
  return steps.length ? Math.max(...steps) : null;
}

/**
 * @param {object} order - the order document (lean)
 * @param {object|null} progress - customerOrderProgress(order)
 * @param {{ returns?: Array<{status: string}>, now?: number }} [opts]
 *   returns: this order's ReturnRequest rows (status only)
 * @returns {null | {
 *   key: string,
 *   refundDue?: boolean,                 // cancelled: the order had been paid
 *   refund?: { amount: number } | null,  // refunded: the order-level refund amount (rupees), when recorded
 *   returnStep?: number,                 // returning: 0 requested, 1 pickup, 2 received
 *   late?: { dueDay: string },           // late: the date we promised, 'YYYY-MM-DD'
 *   note?: string,                       // delivery updates: the team's note, as the customer sees it under the parcel
 *   newDay?: string,                     // date_moved: the new expected day, 'YYYY-MM-DD'
 *   at?: string,                         // delivery updates: when it was recorded (a new one replays)
 * }}
 */
export function orderMoment(order, progress, { returns = [], now = Date.now() } = {}) {
  if (!order) return null;
  const pay = order.paymentStatus;

  if (order.status === 'awaiting_payment') {
    return pay === 'failed' || pay === 'expired' ? { key: MOMENT.PAYMENT_FAILED } : null;
  }

  const refund = order.refundDetails?.requestedAt ? order.refundDetails : null;
  if (pay === 'refunded' || refund?.status === 'completed') {
    const amount = Number(refund?.amount);
    return { key: MOMENT.REFUNDED, refund: amount > 0 ? { amount } : null };
  }

  if (order.status === 'cancelled') return { key: MOMENT.CANCELLED, refundDue: pay === 'paid' };

  const step = returnStep(order, returns);
  if (step != null) return { key: MOMENT.RETURNING, returnStep: step };

  if (!progress) return null;
  const last = STEPS[STEPS.length - 1];
  const done = new Set((progress.steps || []).filter((s) => s.done).map((s) => s.key));
  if (done.has(last)) return { key: MOMENT.DELIVERED };

  if (progress.onHold) return { key: MOMENT.ON_HOLD };

  // At the door beats "late": the customer needs to know the courier is (or was) there.
  const update = latestParcelUpdate(order);
  if (update && (update.key === MOMENT.DELIVERY_FAILED || update.key === MOMENT.OUT_FOR_DELIVERY)) return update;

  const due = promisedDay(progress.estimate);
  if (due && istDay(now) > due) return { key: MOMENT.LATE, late: { dueDay: due } };

  if (update) return update;

  const parcels = progress.parcels || {};
  if (parcels.shipped > 0 && parcels.total > parcels.shipped) return { key: MOMENT.PARTLY };

  const lastDone = [...STEPS].reverse().find((k) => done.has(k));
  return { key: lastDone || MOMENT.PLACED };
}

export default { MOMENT, RETURN_STEP, orderMoment, latestParcelUpdate, promisedDay, istDay, istDayPlus };
