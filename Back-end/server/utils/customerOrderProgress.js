/**
 * The progress timeline the customer sees on their order page (GET /orders/:id →
 * `progress`). Built from utils/customerJourney.js, so the page and the emails can
 * never disagree about which step the order is on.
 *
 * Only step keys, dates and a delivery estimate leave the server — never staff names,
 * suppliers or notes (the workflow it reads is stripped from the customer response).
 *
 * The estimate is honest by construction:
 *   courier   a parcel in transit has a date the team set from the courier
 *             (shipments[].eta.day, IST 'YYYY-MM-DD') or the carrier's estimate;
 *             the LATEST such date when several boxes are travelling.
 *   window    otherwise the same 7–10 / 10–15 day window the product page promised
 *             (utils/deliveryWindow.js), counted from the day the order was placed.
 *             The frontend turns it into dates (Front-end/web/src/lib/deliveryWindow.ts).
 */
import { customerJourney } from './customerJourney.js';
import { deliveryWindowFor, DELIVERY_WINDOWS } from './deliveryWindow.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The latest courier date among parcels still on their way, as 'YYYY-MM-DD', or null. */
function courierEtaDay(order) {
  const days = (order.shipments || [])
    .filter((s) => s?.status === 'shipped')
    .map((s) => {
      if (DAY_RE.test(String(s.eta?.day || ''))) return s.eta.day;
      const d = s.estimatedDelivery ? new Date(s.estimatedDelivery) : null;
      // IST calendar day of the carrier's estimate.
      return d && Number.isFinite(d.getTime()) ? new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10) : null;
    })
    .filter(Boolean)
    .sort();
  return days.length ? days[days.length - 1] : null;
}

/** The slowest window across the order's items: one heavy item sets the pace. */
function orderWindow(order) {
  const heavy = (order.items || []).some((i) => i?.product && typeof i.product === 'object' && deliveryWindowFor(i.product).heavy);
  const w = heavy ? DELIVERY_WINDOWS.heavy : DELIVERY_WINDOWS.general;
  return { minDays: w.minDays, maxDays: w.maxDays, heavy };
}

/**
 * @param {object} order - the full order (workflow included)
 * @returns {null | {
 *   current: string,        // the step being worked on ('delivered' while in transit, and once delivered)
 *   onHold: boolean,
 *   steps: Array<{ key: string, at: string|null, done: boolean }>,
 *   parcels: { total: number, shipped: number, delivered: number },
 *   estimate: null | { kind: 'courier', day: string } | { kind: 'window', from: string, minDays: number, maxDays: number, heavy: boolean },
 * }}
 */
export function customerOrderProgress(order) {
  const journey = customerJourney(order);
  if (!journey) return null;

  const placed = journey.steps[0]?.at || null;
  let estimate = null;
  const delivered = journey.steps[journey.steps.length - 1]?.done === true;
  if (!delivered) {
    const day = courierEtaDay(order);
    if (day) estimate = { kind: 'courier', day };
    else if (placed) estimate = { kind: 'window', from: placed.toISOString(), ...orderWindow(order) };
  }

  return {
    current: journey.current,
    onHold: journey.onHold,
    steps: journey.steps.map((s) => ({ key: s.key, at: s.at ? s.at.toISOString() : null, done: s.done })),
    parcels: journey.parcels,
    estimate,
  };
}

export default { customerOrderProgress };
