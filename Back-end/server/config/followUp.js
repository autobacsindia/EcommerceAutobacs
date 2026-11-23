/**
 * Order follow-up engine — every number in one place (services/followUp/*).
 *
 * Owner-approved defaults, 2026-11-23 (shared design contract "followup-design.md"):
 *   office time    Mon–Sat 09:30–18:30 IST, minus STAFF_HOLIDAYS (or SUPPORT_HOLIDAYS)
 *   SLA per stage  in OFFICE minutes (the clock stops at night, on Sundays and holidays)
 *   ladder         remind at 75% of the SLA (panel only) → due at the deadline
 *                  (pop-up + push) → owner's team head 4 office hours later →
 *                  admins 1 office day later
 *   mode           off | shadow | live — shadow (the default) computes and records
 *                  everything and sends NOTHING; the owner flips it to live
 *
 * Every value can be overridden by an env var (Railway dashboard). A bad value
 * never stops the server: it falls back to the default and is logged once.
 */
import { STAGE } from '../utils/teamWorkflow.js';
import { staffHolidays } from './projectTemplates.js';

export const FOLLOWUP_MODES = Object.freeze(['off', 'shadow', 'live']);
export const DEFAULT_FOLLOWUP_MODE = 'shadow';

/** One office day = 09:30–18:30 = 540 minutes. */
const OFFICE_DAY_MIN = 540;

/** Default SLA per workflow stage, in office minutes. `shipped` is date based (below). */
export const DEFAULT_SLA_MIN = Object.freeze({
  [STAGE.STOCK_CHECK]: 120,
  [STAGE.OWN_STOCK]: OFFICE_DAY_MIN,
  [STAGE.TO_SHIP]: 240,
  [STAGE.PAYMENT_PENDING]: 240,
  // The contract says "supplier promised date, else 3 office days". The order has
  // no promised-date field yet, so 3 office days applies to every line for now.
  [STAGE.WITH_SUPPLIER]: 3 * OFFICE_DAY_MIN,
  [STAGE.CUSTOMER_DECISION]: 240,
  [STAGE.ACCOUNTS_APPROVAL]: OFFICE_DAY_MIN,
  // A parcel in transit with no expected date: 3 office days after dispatch.
  // With a date: the end of the expected day (IST) + 1 calendar day.
  [STAGE.SHIPPED]: 3 * OFFICE_DAY_MIN,
});

/** Calendar days of grace after a parcel's expected delivery day. */
export const DEFAULT_PARCEL_GRACE_DAYS = 1;

export const LADDER_LEVELS = Object.freeze(['remind', 'due', 'head', 'admin']);

/**
 * Why a step is late. One server-side list for every stage (wave 2 piece D makes a
 * reason required). `control` says whose fault it can be: an `outside` reason is
 * not counted against the person on the My delays page. `other` needs a note.
 */
export const FOLLOWUP_REASONS = Object.freeze({
  courier_delay: Object.freeze({ label: 'Courier delay', control: 'outside' }),
  customer_unreachable: Object.freeze({ label: 'Customer unreachable', control: 'outside' }),
  address_issue: Object.freeze({ label: 'Address issue', control: 'outside' }),
  force_majeure: Object.freeze({ label: 'Supplier holiday / force majeure', control: 'outside' }),
  stock_wait: Object.freeze({ label: 'Waiting for stock', control: 'inside' }),
  supplier_not_chased: Object.freeze({ label: 'Supplier not chased', control: 'inside' }),
  not_packed: Object.freeze({ label: 'Not packed yet', control: 'inside' }),
  approval_wait: Object.freeze({ label: 'Waiting for approval', control: 'inside' }),
  payment_wait: Object.freeze({ label: 'Waiting for payment', control: 'inside' }),
  other: Object.freeze({ label: 'Other', control: 'inside', noteRequired: true }),
});
export const FOLLOWUP_REASON_CODES = Object.freeze(Object.keys(FOLLOWUP_REASONS));
export const FOLLOWUP_NOTE_MAX = 300;
/** A "next follow-up date" may be at most this far ahead. */
export const FOLLOWUP_NEXT_MAX_DAYS = 30;

const DEFAULTS = Object.freeze({
  mode: DEFAULT_FOLLOWUP_MODE,
  office: Object.freeze({ startMinute: 9 * 60 + 30, endMinute: 18 * 60 + 30, days: Object.freeze([1, 2, 3, 4, 5, 6]) }),
  sla: DEFAULT_SLA_MIN,
  parcelGraceDays: DEFAULT_PARCEL_GRACE_DAYS,
  remindFraction: 0.75,
  headAfterMin: 4 * 60,
  adminAfterMin: OFFICE_DAY_MIN,
  maxOrders: 5000,
  pageSize: 100,
});

/** "HH:MM" → minutes after midnight, or null. */
function readClock(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 24 * 60 ? h * 60 + min : null;
}

/** "1-6" or "1,2,3,4,5,6" (0 = Sunday) → sorted unique days, or null. */
function readDays(raw) {
  const s = String(raw).trim();
  let days;
  const range = /^([0-6])-([0-6])$/.exec(s);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (a > b) return null;
    days = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  } else {
    const parts = s.split(',').map((x) => x.trim());
    if (!parts.every((p) => /^[0-6]$/.test(p))) return null;
    days = parts.map(Number);
  }
  return [...new Set(days)].sort();
}

const intIn = (lo, hi) => (raw) => {
  const n = Number(raw);
  return /^\d+$/.test(String(raw).trim()) && n >= lo && n <= hi ? n : null;
};

const STAGE_ENV = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_SLA_MIN).map((s) => [s, `FOLLOWUP_SLA_${s.toUpperCase()}_MIN`])));

const warned = new Set();
function warnOnce(msg, log) {
  if (warned.has(msg)) return;
  warned.add(msg);
  log(`[FollowUp] ${msg}`);
}

/**
 * The engine's settings from `env`, each validated. Returns a frozen object plus
 * the problems found (also logged once each). Pure apart from that log.
 */
export function loadFollowUpConfig(env = process.env, log = console.warn) {
  const problems = [];
  const pick = (name, parse, fallback) => {
    const raw = env[name];
    if (raw == null || String(raw).trim() === '') return fallback;
    const v = parse(raw);
    if (v == null) {
      problems.push(`${name}="${raw}" is not valid — using the default`);
      return fallback;
    }
    return v;
  };

  const modeRaw = env.FOLLOWUP_MODE;
  let mode = DEFAULTS.mode;
  if (modeRaw != null && String(modeRaw).trim() !== '') {
    const m = String(modeRaw).trim().toLowerCase();
    if (FOLLOWUP_MODES.includes(m)) mode = m;
    else problems.push(`FOLLOWUP_MODE="${modeRaw}" is not off|shadow|live — using "${DEFAULTS.mode}"`);
  }

  let startMinute = pick('FOLLOWUP_OFFICE_START', readClock, DEFAULTS.office.startMinute);
  let endMinute = pick('FOLLOWUP_OFFICE_END', readClock, DEFAULTS.office.endMinute);
  if (endMinute - startMinute < 60) {
    problems.push('FOLLOWUP_OFFICE_START/END leave under an hour of office time — using 09:30–18:30');
    startMinute = DEFAULTS.office.startMinute;
    endMinute = DEFAULTS.office.endMinute;
  }
  const days = pick('FOLLOWUP_OFFICE_DAYS', readDays, DEFAULTS.office.days);

  const sla = {};
  for (const [stage, def] of Object.entries(DEFAULT_SLA_MIN)) {
    sla[stage] = pick(STAGE_ENV[stage], intIn(5, 30 * OFFICE_DAY_MIN), def);
  }

  const remindPct = pick('FOLLOWUP_REMIND_PERCENT', intIn(10, 95), Math.round(DEFAULTS.remindFraction * 100));
  let headAfterMin = pick('FOLLOWUP_HEAD_AFTER_MIN', intIn(0, 10 * OFFICE_DAY_MIN), DEFAULTS.headAfterMin);
  let adminAfterMin = pick('FOLLOWUP_ADMIN_AFTER_MIN', intIn(0, 20 * OFFICE_DAY_MIN), DEFAULTS.adminAfterMin);
  if (adminAfterMin < headAfterMin) {
    problems.push('FOLLOWUP_ADMIN_AFTER_MIN is before FOLLOWUP_HEAD_AFTER_MIN — using the defaults for both');
    headAfterMin = DEFAULTS.headAfterMin;
    adminAfterMin = DEFAULTS.adminAfterMin;
  }

  problems.forEach((p) => warnOnce(p, log));
  return Object.freeze({
    mode,
    office: Object.freeze({ startMinute, endMinute, days: Object.freeze(days), holidays: staffHolidays(env) }),
    sla: Object.freeze(sla),
    parcelGraceDays: pick('FOLLOWUP_PARCEL_GRACE_DAYS', intIn(0, 14), DEFAULTS.parcelGraceDays),
    remindFraction: remindPct / 100,
    headAfterMin,
    adminAfterMin,
    maxOrders: pick('FOLLOWUP_MAX_ORDERS', intIn(100, 50000), DEFAULTS.maxOrders),
    pageSize: DEFAULTS.pageSize,
    problems: Object.freeze(problems),
  });
}

/** Test hook: forget which warnings were already logged. */
export const resetFollowUpWarnings = () => warned.clear();
