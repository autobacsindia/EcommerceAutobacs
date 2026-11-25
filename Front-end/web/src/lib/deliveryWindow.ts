/**
 * Delivery estimate — FORMATTING ONLY. The window itself (how many days, heavy or
 * not) is the server's: Back-end/server/utils/deliveryWindow.js, served by
 * GET /delivery-fees/estimates. "Nothing Extra" campaign, 2026-11-23.
 *
 * `GENERAL_DELIVERY_COPY` is the one sentence for places with no product to ask
 * about (order success page fallback, shipping page, FAQ). Keep its numbers in step
 * with DELIVERY_WINDOWS on the server.
 */
export interface DeliveryWindow {
  minDays: number;
  maxDays: number;
  heavy: boolean;
}

export const GENERAL_DELIVERY_DAYS = '7–10 days';
export const HEAVY_DELIVERY_DAYS = 'up to 15 days';
export const GENERAL_DELIVERY_COPY = `Usually delivered in ${GENERAL_DELIVERY_DAYS}, ${HEAVY_DELIVERY_DAYS} for heavy goods`;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "7–10 days" */
export function windowDays(w: Pick<DeliveryWindow, 'minDays' | 'maxDays'>): string {
  return w.minDays === w.maxDays ? `${w.maxDays} days` : `${w.minDays}–${w.maxDays} days`;
}

/**
 * The calendar day in India `days` after `now`, pushed past a Sunday (couriers do not
 * deliver then) — so a date we show is never earlier than the day count allows.
 * Returned as a UTC-midnight Date of that India day, for formatting with timeZone UTC.
 */
export function istDayPlus(now: number, days: number): Date {
  const ist = new Date(now + IST_OFFSET_MS);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) + days * DAY_MS);
  return day.getUTCDay() === 0 ? new Date(day.getTime() + DAY_MS) : day;
}

const fmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Wed 2 Dec – Sat 5 Dec" for an order placed at `now`. */
export function windowDates(w: Pick<DeliveryWindow, 'minDays' | 'maxDays'>, now: number): string {
  const part = (d: Date) => fmt.format(d).replace(',', '');
  return `${part(istDayPlus(now, w.minDays))} – ${part(istDayPlus(now, w.maxDays))}`;
}
