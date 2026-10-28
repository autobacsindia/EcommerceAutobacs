/**
 * Expected delivery date (ETA) on a parcel in transit — staff only.
 *
 * Procurement / operations set it after checking with the courier; the morning
 * job (services/parcelEtaReminders.js) reminds them in team chat on that day, and
 * every working morning after it while the parcel is still in transit, until they
 * mark it delivered or set a new date.
 *
 * Kept apart from `shipments[].estimatedDelivery`, which is the CUSTOMER's date
 * (it goes in the shipped email). This one is the team's working estimate and is
 * never shown to the customer.
 *
 * A date is stored as the India calendar day, 'YYYY-MM-DD' — not a timestamp —
 * so "today", "overdue" and the reminder all mean the same day for everyone,
 * whatever the server's clock zone.
 */
import { SHIPMENT_STATUS } from './orderFulfilment.js';

/** How far ahead an ETA may be set. Beyond this it is a guess, not an estimate. */
export const ETA_MAX_DAYS = 60;
/** Date changes kept per parcel (newest). */
export const MAX_ETA_HISTORY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day in India at `now`, as 'YYYY-MM-DD'. */
export const istDay = (now = Date.now()) => new Date(Number(now) + IST_OFFSET_MS).toISOString().slice(0, 10);

/** A 'YYYY-MM-DD' that is a real calendar date, or null (2026-02-30 is not). */
export function parseEtaDay(value) {
  const s = String(value ?? '').trim();
  if (!DAY_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); negative when `to` is earlier. */
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** "28/10/2026" — how the team writes dates. */
export function formatEtaDay(day) {
  const [y, m, d] = String(day || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/**
 * Why `day` cannot be an ETA set on `today`, or null when it can: not before
 * today, not more than ETA_MAX_DAYS ahead.
 */
export function etaDayProblem(day, today) {
  if (!day) return 'Choose a valid date.';
  if (day < today) return 'The expected delivery date cannot be in the past.';
  if (daysBetween(today, day) > ETA_MAX_DAYS) return `Choose a date within the next ${ETA_MAX_DAYS} days.`;
  return null;
}

/**
 * Where a parcel stands against its ETA on `today`:
 *   null        — not in transit (delivered, lost, packed): nothing to chase
 *   'none'      — in transit, no date set yet
 *   'upcoming'  — date is in the future
 *   'due_today' — date is today
 *   'overdue'   — date has passed and it is still in transit
 */
export function etaState(parcel, today) {
  if (parcel?.status !== SHIPMENT_STATUS.SHIPPED) return null;
  const day = parcel.eta?.day;
  if (!day) return 'none';
  if (day === today) return 'due_today';
  return day < today ? 'overdue' : 'upcoming';
}

/**
 * One order's parcels in transit, summed up for its list row: how many are
 * overdue / due today / have no date, and the earliest date set. null when no
 * parcel is in transit.
 */
export function etaSummary(shipments, today) {
  let inTransit = 0;
  const out = { overdue: 0, dueToday: 0, missing: 0, earliest: null };
  for (const s of shipments || []) {
    const state = etaState(s, today);
    if (!state) continue;
    inTransit += 1;
    if (state === 'overdue') out.overdue += 1;
    else if (state === 'due_today') out.dueToday += 1;
    else if (state === 'none') out.missing += 1;
    if (s.eta?.day && (!out.earliest || s.eta.day < out.earliest)) out.earliest = s.eta.day;
  }
  return inTransit ? out : null;
}
