/**
 * Task deadline alerts — every number in one place (services/taskAlertService.js).
 *
 * The ladder for one deadline (owner's ask, 2026-11-24: "you have only X time left",
 * then a reason when it is missed, then the managers hear):
 *   today   the morning of the due day (office opening) → the people doing it
 *   soon    SOON_MIN before the deadline (untimed: before the office closes)
 *           → the people doing it, "only 2h 10m left"
 *   late    at the deadline → the people doing it ("say why, give a new date")
 *           and whoever gave it
 *   head    HEAD_AFTER office minutes later, still late and no new date asked
 *           → the heads of its teams
 *   admin   ADMIN_AFTER office minutes later, same → the admins
 * Office time, holidays and the head/admin gaps are the order follow-up engine's
 * (config/followUp.js), so both ladders keep one clock.
 *
 * TASK_ALERTS_MODE: off | shadow (claims, sends nothing) | live (default). Live is
 * safe on the first deploy: a level whose moment passed more than STALE_MIN ago is
 * claimed silently, so the tasks already late do not fire a burst.
 */
import { loadFollowUpConfig } from './followUp.js';

export const TASK_ALERT_MODES = Object.freeze(['off', 'shadow', 'live']);
export const TASK_ALERT_LEVELS = Object.freeze(['today', 'soon', 'late', 'head', 'admin']);

const DEFAULTS = Object.freeze({
  mode: 'live',
  soonMin: 180,
  // Older than this: claimed without sending (first deploy, a long outage).
  staleMin: 24 * 60,
  // Tasks due this many days back are still walked (head/admin can be days after
  // a deadline across a Sunday and a holiday). Older ones have finished their ladder.
  lookbackDays: 7,
  maxTasks: 5000,
  pageSize: 200,
});

const int = (raw, lo, hi) => {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
};

const warned = new Set();

/** Settings from `env`; a bad value falls back to the default and is logged once. */
export function loadTaskAlertConfig(env = process.env, log = console.warn) {
  const problem = (msg) => { if (!warned.has(msg)) { warned.add(msg); log(`[TaskAlerts] ${msg}`); } };
  const pick = (name, lo, hi, fallback) => {
    if (env[name] == null || String(env[name]).trim() === '') return fallback;
    const v = int(env[name], lo, hi);
    if (v == null) problem(`${name}="${env[name]}" is not valid — using ${fallback}`);
    return v ?? fallback;
  };
  let mode = DEFAULTS.mode;
  const raw = env.TASK_ALERTS_MODE;
  if (raw != null && String(raw).trim() !== '') {
    const m = String(raw).trim().toLowerCase();
    if (TASK_ALERT_MODES.includes(m)) mode = m;
    else problem(`TASK_ALERTS_MODE="${raw}" is not off|shadow|live — using "${DEFAULTS.mode}"`);
  }
  const followUp = loadFollowUpConfig(env, log);
  return Object.freeze({
    mode,
    soonMin: pick('TASK_ALERTS_SOON_MIN', 15, 8 * 60, DEFAULTS.soonMin),
    staleMin: DEFAULTS.staleMin,
    lookbackDays: DEFAULTS.lookbackDays,
    maxTasks: DEFAULTS.maxTasks,
    pageSize: DEFAULTS.pageSize,
    office: followUp.office,
    headAfterMin: followUp.headAfterMin,
    adminAfterMin: followUp.adminAfterMin,
  });
}
