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
 *   late            today (India) is past the date we promised — the courier's date
 *                   or the end of the 7–10 / 10–15 day window the page shows
 *   partly          some parcels shipped, not all
 *   shipped | packed | preparing | placed   the last step that is done
 *
 * "Late" is measured against the promise the customer was shown, never against an
 * internal SLA: a "sorry, it's late" on day 3 of a 7–10 day window would alarm a
 * customer whose order is on time. There is no "new date" — nothing on the order
 * holds a revised promise, and inventing one would be worse than saying we're on it.
 *
 * Pure, no I/O.
 */
import { STEPS } from './customerJourney.js';

export const MOMENT = Object.freeze({
  PAYMENT_FAILED: 'payment_failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  RETURNING: 'returning',
  DELIVERED: 'delivered',
  ON_HOLD: 'on_hold',
  LATE: 'late',
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

  const due = promisedDay(progress.estimate);
  if (due && istDay(now) > due) return { key: MOMENT.LATE, late: { dueDay: due } };

  const parcels = progress.parcels || {};
  if (parcels.shipped > 0 && parcels.total > parcels.shipped) return { key: MOMENT.PARTLY };

  const lastDone = [...STEPS].reverse().find((k) => done.has(k));
  return { key: lastDone || MOMENT.PLACED };
}

export default { MOMENT, RETURN_STEP, orderMoment, promisedDay, istDay, istDayPlus };
