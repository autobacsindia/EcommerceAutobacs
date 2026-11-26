/**
 * Customer progress updates — every number in one place (services/orderProgressService.js).
 *
 * The milestones between "order confirmed" and "shipped" (preparing, packed, courier
 * booked) and the one gentle "still on it" note when a step runs long.
 *
 *   CUSTOMER_PROGRESS_UPDATES      on | off (default on). off = no milestone or
 *                                  reassurance message is queued or sent; the order
 *                                  page timeline still shows.
 *   CUSTOMER_REASSURE_OFFICE_DAYS  office days a pre-dispatch step may run with no
 *                                  news before the customer gets ONE "still on it"
 *                                  note for that step (default 2).
 *   CUSTOMER_REASSURE_MAX_AGE_DAYS a step older than this (calendar days) gets no
 *                                  note at all (default 14). Stops the first run
 *                                  after deploy from writing to long-stuck backlog —
 *                                  those need a person, not an automatic email.
 *   CUSTOMER_PREPARING_DELAY_MIN   minutes between the stock decision and the
 *                                  "being prepared" message (default 20). An item
 *                                  shipped within that time skips it: the shipped
 *                                  email already says more.
 *   CUSTOMER_PROGRESS_CRON         sweep schedule (default every 15 min); it runs in
 *                                  office time only (the follow-up engine's office
 *                                  hours and STAFF_HOLIDAYS).
 */
import { loadFollowUpConfig } from './followUp.js';

const DEFAULTS = Object.freeze({
  reassureOfficeDays: 2,
  reassureMaxAgeDays: 14,
  preparingDelayMin: 20,
  cron: '*/15 * * * *',
  // The sweep reads processing orders placed in this many days, newest first,
  // 100 at a time, at most 3000 per run.
  scanWindowDays: 45,
  pageSize: 100,
  maxOrders: 3000,
});

/** One office day in minutes, from the office hours in force. */
const officeDayMinutes = (office) => Math.max(60, office.endMinute - office.startMinute);

const num = (raw, min, max, fallback) => {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ enabled: boolean, reassureAfterMin: number, reassureMaxAgeMs: number,
 *   preparingDelayMs: number, cron: string, scanWindowMs: number, pageSize: number,
 *   maxOrders: number, office: object }}
 */
export function loadCustomerProgressConfig(env = process.env) {
  const office = loadFollowUpConfig(env, () => {}).office;
  const enabled = String(env.CUSTOMER_PROGRESS_UPDATES || 'on').trim().toLowerCase() !== 'off';
  const days = num(env.CUSTOMER_REASSURE_OFFICE_DAYS, 1, 10, DEFAULTS.reassureOfficeDays);
  return {
    enabled,
    reassureAfterMin: Math.round(days * officeDayMinutes(office)),
    reassureMaxAgeMs: num(env.CUSTOMER_REASSURE_MAX_AGE_DAYS, 1, 60, DEFAULTS.reassureMaxAgeDays) * 24 * 60 * 60 * 1000,
    preparingDelayMs: num(env.CUSTOMER_PREPARING_DELAY_MIN, 0, 240, DEFAULTS.preparingDelayMin) * 60 * 1000,
    cron: String(env.CUSTOMER_PROGRESS_CRON || '').trim() || DEFAULTS.cron,
    scanWindowMs: DEFAULTS.scanWindowDays * 24 * 60 * 60 * 1000,
    pageSize: DEFAULTS.pageSize,
    maxOrders: DEFAULTS.maxOrders,
    office,
  };
}

export default { loadCustomerProgressConfig };
