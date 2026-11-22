/**
 * Reimbursements — a staff member claiming back what they spent themself
 * (owner, 2026-11-21). An expense PaymentRequest with category 'reimbursement'
 * and a `reimbursement` sub-document; everything after submit (accounts approves,
 * the admin pays, lists, totals) is the ordinary expense flow.
 *
 *   Fuel           the requester types KM only. amount = km × the per-km rate,
 *                  worked out HERE — a client-sent amount is ignored. The rate is
 *                  the admin's setting (default ₹15) at submit time, snapshotted on
 *                  the claim: a later rate change never rewrites an old claim, and
 *                  editing an old claim's km recomputes at ITS rate.
 *   Food, Transportation, Others
 *                  a typed rupee amount. A bill is required above ₹200
 *                  (BILL_REQUIRED_ABOVE). Others also needs details.
 *
 * Always rupees: a reimbursement is paid to our own staff in India.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import reimbursementConfigRepository, { REIMBURSEMENT_DEFAULTS, FUEL_RATE_MAX } from '../repositories/reimbursementConfigRepository.js';
import { REIMBURSEMENT_TYPES, reimbursementTypeLabel } from '../config/expenseCategories.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import { richTextLength } from '../utils/richText.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

/** The most km one Fuel claim may carry (a typo guard: Bengaluru → Delhi is ~2,150 km). */
export const MAX_KM = 1000;
/** Food / Transportation / Others above this many rupees need a bill attached. Fuel never does. */
export const BILL_REQUIRED_ABOVE = 200;
/** How far back a claim's date may be. */
export const MAX_AGE_DAYS = 365;
const PLACE_MAX = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const TYPES = REIMBURSEMENT_TYPES.map((t) => t.value);

const filled = (v) => v != null && v !== '';
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ── The rate ────────────────────────────────────────────────────────────────

const rateOf = (doc) => {
  const n = Number(doc?.fuelRatePerKm);
  return Number.isFinite(n) && n > 0 ? n : REIMBURSEMENT_DEFAULTS.fuelRatePerKm;
};

/** The admin's current per-km fuel rate, in rupees (₹15 until they change it). */
export async function getFuelRate() {
  return rateOf(await reimbursementConfigRepository.find());
}

/** The settings as the panel shows them: the rate and who last changed it. */
export async function readSettings() {
  const doc = await reimbursementConfigRepository.find();
  return { fuelRatePerKm: rateOf(doc), updatedAt: doc?.updatedAt ?? null, updatedByName: doc?.updatedByName ?? '' };
}

/** Change the per-km fuel rate (admin only). New claims use it; submitted ones keep theirs. */
export async function updateSettings(actor, input = {}, req) {
  if (actor?.role !== 'admin') throw fail('Only the admin can change the fuel rate.', 403);
  const raw = input.fuelRatePerKm;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > FUEL_RATE_MAX || round2(n) !== n) {
    throw fail(`Enter the rate per km in rupees — more than ₹0 and at most ₹${FUEL_RATE_MAX}, up to 2 decimals.`, 400);
  }
  const before = await getFuelRate();
  await reimbursementConfigRepository.upsert({ fuelRatePerKm: n, updatedBy: actor._id, updatedByName: actor.name || '' });
  const after = await readSettings();
  auditLogger.logAction(req, 'UPDATE', 'ReimbursementConfig', 'default', { fuelRatePerKm: { before, after: after.fuelRatePerKm } });
  return after;
}

// ── The money ───────────────────────────────────────────────────────────────

/** km × rate in rupees, rounded to the paisa (in paise, so 12.5 km × ₹15 is exactly ₹187.50). */
export const fuelAmount = (km, ratePerKm) => Math.round(km * Math.round(ratePerKm * 100)) / 100;

/** Multipart sends the sub-document as JSON text; accept either. */
function parsed(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { throw fail('The reimbursement details could not be read — try again.', 400); }
}

function cleanKm(raw) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw fail('Enter the kilometres driven (more than 0).', 400);
  if (n > MAX_KM) throw fail(`That is more than ${MAX_KM.toLocaleString('en-IN')} km for one claim — check it, or split it into separate trips.`, 400);
  const km = round2(n);
  if (km <= 0) throw fail('Enter the kilometres driven (more than 0).', 400);
  return km;
}

function cleanDay(raw, today) {
  const s = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw fail('Pick the date of the expense.', 400);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (t > now) throw fail('The date of the expense cannot be in the future.', 400);
  if (now - t > MAX_AGE_DAYS * DAY_MS) throw fail(`The date of the expense is more than ${MAX_AGE_DAYS} days ago — check it.`, 400);
  return s;
}

function cleanPlace(raw, what) {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw fail(`The ${what} place must be text.`, 400);
  // eslint-disable-next-line no-control-regex
  const text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > PLACE_MAX) throw fail(`Keep the ${what} place under ${PLACE_MAX} characters.`, 400);
  return text;
}

/**
 * A reimbursement's details and, for Fuel, its amount — the server's own figure.
 *
 * @param {object} raw       `input.reimbursement` (object or JSON text): type, on, km, from, to
 * @param {object} opts
 * @param {object|null} opts.current   the claim as stored (an edit): fields not sent keep their value
 * @param {() => Promise<number>} opts.rate   the live per-km rate (read only when needed)
 * @param {string} [opts.today]        IST 'YYYY-MM-DD' (tests)
 * @returns {Promise<{ reimbursement: object, amount: number|null }>}  `amount` null: use the typed amount
 */
export async function cleanClaim(raw, { current = null, rate = getFuelRate, today = formatIsoDateIST(new Date()) } = {}) {
  const input = parsed(raw);
  const type = filled(input.type) ? String(input.type) : current?.type;
  if (!TYPES.includes(type)) throw fail(`Choose the kind of reimbursement: ${REIMBURSEMENT_TYPES.map((t) => t.label).join(', ')}.`, 400);
  // An unchanged date on an edit stays, however old it now is.
  const on = filled(input.on) && input.on !== current?.on ? cleanDay(input.on, today) : (current?.on || cleanDay(input.on, today));
  const from = 'from' in input ? cleanPlace(input.from, 'from') : (current?.from || '');
  const to = 'to' in input ? cleanPlace(input.to, 'to') : (current?.to || '');
  if (type !== 'fuel') {
    return { reimbursement: { type, on, km: null, ratePerKm: null, from, to }, amount: null };
  }
  const km = filled(input.km) ? cleanKm(input.km) : (current?.type === 'fuel' && current.km > 0 ? current.km : cleanKm(input.km));
  // The claim's own rate when it already has one (an edit); otherwise today's.
  const ratePerKm = current?.type === 'fuel' && current.ratePerKm > 0 ? current.ratePerKm : await rate();
  return { reimbursement: { type, on, km, ratePerKm, from, to }, amount: fuelAmount(km, ratePerKm) };
}

/** Others: say what it was. */
export function checkClaimNote(claim, description) {
  if (claim.type === 'other' && richTextLength(description) < 3) {
    throw fail('Add details — say what this “Others” reimbursement was for.', 400);
  }
}

/** Food / Transportation / Others above ₹200: a bill must be attached. `kinds`: the request's file kinds. */
export function checkClaimBill(claim, amount, kinds = []) {
  if (claim.type !== 'fuel' && amount > BILL_REQUIRED_ABOVE && !kinds.includes('bill')) {
    throw fail(`Attach the bill — ${reimbursementTypeLabel(claim.type)} claims above ₹${BILL_REQUIRED_ABOVE} need one.`, 400);
  }
}

const kmText = (km) => Number(km).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** "Fuel (42 km × ₹15)" / "Food" — for labels, chat, the slip. '' when it is not a reimbursement. */
export function claimLabel(claim) {
  if (!claim?.type) return '';
  const name = reimbursementTypeLabel(claim.type);
  return claim.type === 'fuel' && claim.km != null
    ? `${name} (${kmText(claim.km)} km × ₹${kmText(claim.ratePerKm)})`
    : name;
}

/** What the form needs: the sub-types, the current rate and the limits. */
export async function claimOptions() {
  return {
    types: REIMBURSEMENT_TYPES.map((t) => ({ ...t })),
    fuelRatePerKm: await getFuelRate(),
    maxKm: MAX_KM,
    billRequiredAbove: BILL_REQUIRED_ABOVE,
    maxAgeDays: MAX_AGE_DAYS,
  };
}
