/**
 * Subscriptions & dues — the tools, subscriptions and purchases each team pays
 * for, and when each is next due (models/SubscriptionDue.js). Accounts checks
 * every entry; a later step reminds people before a verified one falls due.
 *
 * ── WHO DOES WHAT (enforced here; the UI only reflects it) ──────────────────────
 *   add                    any active staff member (for their own team);
 *                          accounts and admin for any team
 *   see                    accounts and admin: every team; a team: its own
 *   edit / delete          whoever added it, their team head, accounts, admin
 *   verify / reject        accounts (and admin)
 *
 * ── EDITING A VERIFIED ITEM ─────────────────────────────────────────────────────
 * Accounts verified a bill: this amount, in this currency, on this day, paid this
 * way. Changing any of those (or the billing cycle) puts it back to "waiting for
 * check". Notes, the link or an invoice do not. Editing a rejected item is how
 * the team fixes and resubmits it.
 *
 * ── NO CARD NUMBERS ─────────────────────────────────────────────────────────────
 * The card is its last 4 digits, exactly. Free text that looks like a full card
 * number is refused (utils/cardNumber.js). There is nowhere to type a CVV or a
 * password.
 *
 * ── ONCE ONLY ───────────────────────────────────────────────────────────────────
 * Every write is a compare-and-set on `rev` (the version the person was looking
 * at): a double click, or two people at once, changes it once; the other is told
 * to refresh. "Delete" archives — the record and its history stay.
 */
import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import subscriptionDueRepository from '../repositories/subscriptionDueRepository.js';
import counterRepository from '../repositories/counterRepository.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { MAX_ATTACHMENTS_PER_RECORD } from '../config/attachments.js';
import { postSystemMessage } from './chatService.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS, STAFF_TEAM_VALUES } from '../config/staff.js';
import { BASE_CURRENCY, EXPENSE_CURRENCIES } from '../config/expenseCategories.js';
import { ROUGH_INR_PER_UNIT, roughInr } from '../config/roughFxRates.js';
import { containsCardNumber } from '../utils/cardNumber.js';
import { and, isObjectId, keysetPage, plainQuery, searchClauses, searchWords } from '../utils/listQuery.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const SUBSCRIPTION_FILES_FOLDER = 'subscription-dues'; // a PRIVATE prefix (storage/assetScope.js)
// A typo guard, generous for currencies with large numbers (yen, won) — not a business limit.
export const MAX_AMOUNT = 1000000000;
const PAGE_SIZE = 25;
const SUMMARY_CAP = 1000;

export const KINDS = Object.freeze({ monthly: 'Monthly subscription', yearly: 'Yearly subscription', one_time: 'One-time purchase' });
export const METHODS = Object.freeze({ card: 'Card', upi: 'UPI', bank_transfer: 'Bank transfer' });
export const STATUS_LABELS = Object.freeze({ pending: 'Waiting for check', verified: 'Verified', rejected: 'Rejected' });
/** The fields accounts verified: changing one puts a verified item back to "waiting for check". */
export const CHECKED_FIELDS = Object.freeze(['amount', 'currency', 'dueDate', 'kind', 'payment.method', 'payment.cardLast4', 'payment.autoDebit']);

// ── Who ───────────────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isAccounts = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.ACCOUNTS;
const seesAll = (u) => isAdmin(u) || isAccounts(u);
const roleOf = (u) => (isAdmin(u) ? 'admin' : u?.staff?.team || '');
const mayCheck = (u) => seesAll(u);
const canSee = (u, r) => seesAll(u) || (isActiveStaff(u) && u.staff.team === r.team);
const isHeadOf = (u, team) => isActiveStaff(u) && u.staff.isHead === true && u.staff.team === team;
/** Edit or delete: whoever added it (while still on that team), their team head, accounts, admin. */
const mayChange = (u, r) => !r.archived && (
  seesAll(u)
  || (isActiveStaff(u) && u.staff.team === r.team && (idOf(r.addedBy) === idOf(u._id) || isHeadOf(u, r.team)))
);

const entry = (actor, action, note = '') => ({
  at: new Date(),
  by: actor._id,
  byName: actor.name || '',
  role: roleOf(actor),
  action,
  note: String(note || '').slice(0, 1000),
});

// ── Dates (India time) ───────────────────────────────────────────────────────

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Today in India, 'YYYY-MM-DD'. */
export const todayIst = (now = new Date()) => IST_DAY.format(now);
/** 'YYYY-MM-DD' plus `days` calendar days. */
export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
/** "2 Dec 2026" */
export const dayText = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

// ── Input checks ─────────────────────────────────────────────────────────────

const filled = (v) => v != null && v !== '';
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1 || v === 'yes';
const CARD_IN_TEXT = 'That looks like a full card number. Never type card numbers here — the card is its last 4 digits only.';

function noCard(value) {
  if (containsCardNumber(value)) throw fail(CARD_IN_TEXT, 400);
  return value;
}

function cleanName(v) {
  const name = text(v, 80);
  if (name.length < 2) throw fail('Enter the name of the tool or bill (e.g. Railway).', 400);
  return noCard(name);
}

function cleanAmount(v) {
  const n = Math.round(Number(v) * 100) / 100;
  if (!filled(v) || !Number.isFinite(n) || n <= 0) throw fail('Enter the amount on the bill (more than 0).', 400);
  if (n > MAX_AMOUNT) throw fail('That amount looks too large — check it.', 400);
  return n;
}

function cleanCurrency(v) {
  const code = String(v || '').trim().toUpperCase();
  if (!EXPENSE_CURRENCIES.some((c) => c.code === code)) throw fail('Choose the currency the bill is in.', 400);
  return code;
}

/** A real calendar day, within a sane range. A past day is allowed: a bill can already be overdue. */
export function cleanDueDate(v, now = new Date()) {
  const ymd = String(v || '').trim().slice(0, 10);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(ymd) && new Date(`${ymd}T00:00:00Z`).toISOString().slice(0, 10) === ymd;
  if (!ok) throw fail('Enter the next due date.', 400);
  const today = todayIst(now);
  if (ymd < addDays(today, -366 * 2) || ymd > addDays(today, 366 * 10)) throw fail('That due date looks wrong — check the year.', 400);
  return ymd;
}

function cleanKind(v) {
  if (!KINDS[v]) throw fail('Choose the type: monthly, yearly or one-time purchase.', 400);
  return v;
}

/** How it is paid. A card is its last 4 digits — exactly 4, nothing else. */
export function cleanPayment(input = {}) {
  const method = String(input.method || '');
  if (!METHODS[method]) throw fail('Choose how it is paid: card, UPI or bank transfer.', 400);
  const raw = String(input.cardLast4 ?? '').trim();
  let cardLast4 = '';
  if (method === 'card') {
    if (!/^\d{4}$/.test(raw)) {
      throw fail(raw.replace(/\D/g, '').length > 4
        ? 'Enter only the LAST 4 digits of the card — never the full card number.'
        : 'Enter the last 4 digits of the card.', 400);
    }
    cardLast4 = raw;
  } else if (raw.replace(/\D/g, '').length > 4) {
    throw fail('Enter only the LAST 4 digits of the card — never the full card number.', 400);
  }
  return { method, cardLast4, autoDebit: truthy(input.autoDebit) };
}

/** The billing page: an https link (or nothing). */
export function cleanUrl(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw fail('The billing page link must be a full web address starting with https://', 400); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw fail('The billing page link must be a full web address starting with https://', 400);
  }
  if (raw.length > 500) throw fail('That link is too long.', 400);
  return url.toString();
}

/** The team an item is for: staff add for their own team; accounts and admin may pick any. */
function teamFor(actor, wanted, current = null) {
  if (seesAll(actor) && filled(wanted)) {
    const team = String(wanted);
    if (!STAFF_TEAM_VALUES.includes(team)) throw fail('Choose the team this is for.', 400);
    return team;
  }
  if (current) return current;
  const own = actor?.staff?.team;
  if (!isActiveStaff(actor) || !STAFF_TEAM_VALUES.includes(own)) throw fail('Choose the team this is for.', 400);
  return own;
}

/** Every field of a new item, or — for an edit — the fields sent, checked. */
function cleanFields(input, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || input[k] !== undefined;
  if (has('name')) out.name = cleanName(input.name);
  if (has('purpose')) {
    out.purpose = noCard(text(input.purpose, 300));
    if (!partial && out.purpose.length < 3) throw fail('Say what it is for (e.g. hosts the website backend).', 400);
  }
  if (has('kind')) out.kind = cleanKind(input.kind);
  if (has('amount')) out.amount = cleanAmount(input.amount);
  if (has('currency')) out.currency = cleanCurrency(input.currency);
  if (has('dueDate')) out.dueDate = cleanDueDate(input.dueDate);
  if (has('payment')) out.payment = cleanPayment(input.payment || {});
  if (has('billingUrl')) out.billingUrl = cleanUrl(input.billingUrl);
  if (has('notes')) out.notes = noCard(String(input.notes ?? '').trim().slice(0, 1000));
  return out;
}

// ── Files ────────────────────────────────────────────────────────────────────

const resourceTypeOf = (f) => (f.contentType === 'application/pdf' ? 'raw' : 'image');

async function storeInvoices(files, actor, { existing = 0 } = {}) {
  const list = (files || []).filter((f) => f?.buffer?.length);
  if (existing + list.length > MAX_ATTACHMENTS_PER_RECORD) throw fail(`An item holds at most ${MAX_ATTACHMENTS_PER_RECORD} files.`, 400);
  const checked = checkAttachments(list, { existing, noun: 'invoice' });
  return storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer,
      folder: SUBSCRIPTION_FILES_FOLDER,
      basename: `invoice-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType,
      cloudinaryPrivate: true,
    });
    return {
      kind: 'invoice', publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes,
      name, uploadedBy: actor._id, uploadedAt: new Date(),
    };
  }, removeFile);
}

const removeFile = (f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) });

/** Files stored for a write that then did not happen: best-effort clean-up. */
async function discard(files) {
  await Promise.all(files.map((f) => removeFile(f).catch((err) => console.error('[SubscriptionDue] file clean-up failed:', err.message))));
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const money = (r) => `${r.currency} ${Number(r.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
/** "auto-debit, card 4007", "UPI", "bank transfer" */
const howPaid = (p = {}) => [
  p.autoDebit ? 'auto-debit' : '',
  p.method === 'card' ? `card ${p.cardLast4 || ''}`.trim() : (METHODS[p.method] || '').replace('Bank', 'bank'),
].filter(Boolean).join(', ');
const what = (r) => `${r.name} (${r.number}) — ${money(r)}${r.kind === 'one_time' ? '' : r.kind === 'yearly' ? '/year' : '/month'}, due ${dayText(r.dueDate)}, ${howPaid(r.payment)}`;

/**
 * One thread per item in #accounts (who checks it) and the item's team space
 * (so they see it move) — the same system posts Payments uses. Best-effort: chat
 * never blocks a save. Keyed by item, action and rev, so a retry posts once.
 */
async function tellChat(r, action, message, { mention = [] } = {}) {
  try {
    const spaces = [...new Set(['team:accounts', `team:${r.team}`])];
    await Promise.all(spaces.map((space) => postSystemMessage(space, message, {
      key: `subdue-${idOf(r._id)}-${action}-${r.rev}`,
      mentions: mention.map(idOf),
      threadOrder: idOf(r._id),
    })));
  } catch (err) {
    console.error('[SubscriptionDue] chat update failed (ignored):', err.message);
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What the panel shows, and what this person may do with it now. */
export function shape(r, viewer, { now = new Date() } = {}) {
  const today = todayIst(now);
  const dueInDays = daysBetween(today, r.dueDate);
  const can = {
    edit: mayChange(viewer, r),
    delete: mayChange(viewer, r),
    verify: !r.archived && mayCheck(viewer) && r.status === 'pending',
    reject: !r.archived && mayCheck(viewer) && r.status !== 'rejected',
  };
  return {
    id: idOf(r._id),
    number: r.number,
    name: r.name,
    purpose: r.purpose || '',
    team: r.team,
    teamLabel: STAFF_TEAM_LABELS[r.team] || r.team,
    kind: r.kind,
    kindLabel: KINDS[r.kind] || r.kind,
    amount: r.amount,
    currency: r.currency,
    // A rough guide for a foreign bill, worked out now — never stored.
    approxInr: r.currency === BASE_CURRENCY ? null : roughInr(r.amount, r.currency),
    dueDate: r.dueDate,
    dueInDays,
    overdue: dueInDays < 0,
    payment: {
      method: r.payment?.method,
      methodLabel: METHODS[r.payment?.method] || '',
      cardLast4: r.payment?.cardLast4 || '',
      autoDebit: Boolean(r.payment?.autoDebit),
    },
    billingUrl: r.billingUrl || '',
    notes: r.notes || '',
    files: (r.files || []).map((f) => ({ id: idOf(f._id), name: f.name, contentType: f.contentType, bytes: f.bytes })),
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    rejectReason: r.status === 'rejected' ? r.rejectReason || '' : '',
    verifiedByName: r.status === 'verified' ? r.verifiedByName || '' : '',
    verifiedAt: r.status === 'verified' ? r.verifiedAt : null,
    addedBy: idOf(r.addedBy),
    addedByName: r.addedByName,
    archived: Boolean(r.archived),
    rev: r.rev,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.history ? { history: r.history.map((h) => ({ at: h.at, byName: h.byName, role: h.role, action: h.action, note: h.note })) } : {}),
    can,
  };
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function loadVisible(actor, id, { archivedToo = false } = {}) {
  if (!isObjectId(String(id))) throw fail('Item not found.', 404);
  const r = await subscriptionDueRepository.findById(id);
  if (!r || !canSee(actor, r) || (r.archived && !archivedToo)) throw fail('Item not found.', 404);
  return r;
}

const MOVED = 'Someone has just changed this item. Refresh to see the latest, then try again.';

/** The rev the person was looking at; required on every change so a stale screen cannot overwrite. */
function revOf(input, r) {
  if (!filled(input?.rev)) return r.rev;
  const rev = Number(input.rev);
  if (!Number.isInteger(rev) || rev < 0) throw fail(MOVED, 409);
  return rev;
}

// ── Add / edit / delete ──────────────────────────────────────────────────────

export async function create(actor, input = {}, invoices = [], req) {
  if (!isAdmin(actor) && !isActiveStaff(actor)) throw fail('Only active staff add subscriptions.', 403);
  const team = teamFor(actor, input.team);
  const fields = cleanFields(input);
  const stored = await storeInvoices(invoices, actor);
  let doc;
  try {
    doc = await subscriptionDueRepository.create({
      number: `SD-${String(await counterRepository.next('subscription_due')).padStart(4, '0')}`,
      ...fields,
      team,
      status: 'pending',
      addedBy: actor._id,
      addedByName: actor.name || '',
      files: stored,
      history: [entry(actor, 'added')],
    });
  } catch (err) {
    await discard(stored);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'SubscriptionDue', doc._id, { name: doc.name, team, amount: doc.amount, currency: doc.currency, dueDate: doc.dueDate });
  await tellChat(doc, 'added', `🗓️ New subscription to check: ${what(doc)}. Added by ${doc.addedByName} (${STAFF_TEAM_LABELS[team]}). Accounts: please verify or reject.`);
  return shape(doc, actor);
}

const get = (obj, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), obj);
const same = (a, b) => (a instanceof Date || b instanceof Date ? String(a) === String(b) : a === b);

/** "amount USD 20 → USD 25; due 2 Dec 2026 → 5 Dec 2026" — for the history and chat. */
function describeChanges(before, set) {
  const parts = [];
  if (set.amount !== undefined || set.currency !== undefined) {
    const after = { amount: set.amount ?? before.amount, currency: set.currency ?? before.currency };
    if (after.amount !== before.amount || after.currency !== before.currency) parts.push(`amount ${money(before)} → ${money(after)}`);
  }
  if (set.dueDate !== undefined && set.dueDate !== before.dueDate) parts.push(`due ${dayText(before.dueDate)} → ${dayText(set.dueDate)}`);
  if (set.kind !== undefined && set.kind !== before.kind) parts.push(`type ${KINDS[before.kind]} → ${KINDS[set.kind]}`);
  // Only the payment fields that changed are in `set`; the rest are as before.
  const paymentKeys = ['method', 'cardLast4', 'autoDebit'];
  if (paymentKeys.some((k) => set[`payment.${k}`] !== undefined)) {
    const after = Object.fromEntries(paymentKeys.map((k) => [k, set[`payment.${k}`] ?? before.payment?.[k]]));
    parts.push(`paid by ${howPaid(before.payment)} → ${howPaid(after)}`);
  }
  for (const [k, label] of [['name', 'name'], ['purpose', 'what for'], ['billingUrl', 'billing link'], ['notes', 'notes'], ['team', 'team']]) {
    if (set[k] !== undefined && set[k] !== before[k]) parts.push(`${label} changed`);
  }
  return parts;
}

/**
 * Change an item. Sends only what changed; `rev` is the version on screen.
 * `removeFileIds` drops invoices; new invoices come as files.
 */
export async function update(actor, id, input = {}, invoices = [], req) {
  const r = await loadVisible(actor, id);
  if (!mayChange(actor, r)) throw fail('Only the person who added this, their team head, or accounts can change it.', 403);
  const rev = revOf(input, r);
  if (rev !== r.rev) throw fail(MOVED, 409);

  const fields = cleanFields(input, { partial: true });
  const set = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'payment') {
      for (const [pk, pv] of Object.entries(v)) set[`payment.${pk}`] = pv;
    } else set[k] = v;
  }
  if (filled(input.team) && seesAll(actor)) set.team = teamFor(actor, input.team, r.team);
  // Drop fields that did not change, so "saved without changes" does not reset a verification.
  for (const k of Object.keys(set)) if (same(get(r, k), set[k])) delete set[k];

  const removeIds = new Set((Array.isArray(input.removeFileIds) ? input.removeFileIds : []).map(String));
  const removing = (r.files || []).filter((f) => removeIds.has(idOf(f._id)));
  const newFiles = (invoices || []).filter((f) => f?.buffer?.length);
  const changes = describeChanges(r, set);
  if (removing.length) changes.push(`${removing.length} invoice${removing.length > 1 ? 's' : ''} removed`);
  if (newFiles.length) changes.push(`${newFiles.length} invoice${newFiles.length > 1 ? 's' : ''} added`);
  if (!changes.length) return shape(r, actor);

  const moneyChanged = CHECKED_FIELDS.some((k) => set[k] !== undefined);
  // A rejected item is fixed and resubmitted by editing it; a verified one goes back if what was checked changed.
  const recheck = r.status === 'rejected' || (r.status === 'verified' && moneyChanged);
  if (recheck) Object.assign(set, { status: 'pending', rejectReason: '', verifiedBy: null, verifiedByName: '', verifiedAt: null });

  const stored = await storeInvoices(newFiles, actor, { existing: (r.files || []).length - removing.length });
  // The whole list is set (not $push + $pull, which MongoDB refuses on one path in one
  // update): safe, because the write only lands if nobody changed the item since `rev`.
  if (stored.length || removing.length) set.files = [...(r.files || []).filter((f) => !removeIds.has(idOf(f._id))), ...stored];
  const note = changes.join('; ') + (recheck ? ' — back to waiting for check' : '');
  const updated = await subscriptionDueRepository.update(id, { rev }, set, entry(actor, 'edited', note))
    .catch(async (err) => { await discard(stored); throw err; });
  if (!updated) {
    await discard(stored);
    throw fail(MOVED, 409);
  }
  // Only after the record no longer points at them.
  await discard(removing);
  auditLogger.logAction(req, 'UPDATE', 'SubscriptionDue', id, { change: 'edited', fields: Object.keys(set), recheck, removedFiles: removing.length, addedFiles: stored.length });
  if (recheck) {
    await tellChat(updated, 'recheck', `✏️ ${actor.name || 'Someone'} changed ${updated.name} (${updated.number}): ${changes.join('; ')}. Back to waiting for check — Accounts: please verify again.`);
  }
  return shape(updated, actor);
}

/** "Delete": archive it. Gone from every list; the record and its history stay. */
export async function archive(actor, id, input = {}, req) {
  const r = await loadVisible(actor, id);
  if (!mayChange(actor, r)) throw fail('Only the person who added this, their team head, or accounts can delete it.', 403);
  const rev = revOf(input, r);
  const reason = text(input.reason, 500);
  const updated = await subscriptionDueRepository.update(
    id, { rev },
    { archived: true, archivedAt: new Date(), archivedBy: actor._id, archivedByName: actor.name || '' },
    entry(actor, 'archived', reason),
  );
  if (!updated) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'DELETE', 'SubscriptionDue', id, { change: 'archived', name: r.name, reason });
  await tellChat(updated, 'archived', `🗑️ ${actor.name || 'Someone'} deleted ${updated.name} (${updated.number}) from the subscriptions list${reason ? `: “${reason}”` : ''}.`);
  return shape(updated, actor);
}

// ── Check ────────────────────────────────────────────────────────────────────

export async function verify(actor, id, input = {}, req) {
  const r = await loadVisible(actor, id);   // 404s an item this person may not see
  if (!mayCheck(actor)) throw fail('Only accounts (or an admin) verifies subscriptions.', 403);
  const rev = revOf(input, r);
  const updated = await subscriptionDueRepository.update(
    id, { rev, from: ['pending'] },
    { status: 'verified', verifiedBy: actor._id, verifiedByName: actor.name || '', verifiedAt: new Date(), rejectReason: '' },
    entry(actor, 'verified', input.note),
  );
  if (!updated) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'SubscriptionDue', id, { change: 'verified' });
  await tellChat(updated, 'verified', `✅ ${isAdmin(actor) ? 'Admin' : 'Accounts'} verified ${what(updated)}.`);
  return shape(updated, actor);
}

export async function reject(actor, id, input = {}, req) {
  const r = await loadVisible(actor, id);
  if (!mayCheck(actor)) throw fail('Only accounts (or an admin) rejects subscriptions.', 403);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw fail('Say why it is rejected — the team sees this and fixes it.', 400);
  noCard(reason);
  const rev = revOf(input, r);
  const updated = await subscriptionDueRepository.update(
    id, { rev, from: ['pending', 'verified'] },
    { status: 'rejected', rejectReason: reason, verifiedBy: null, verifiedByName: '', verifiedAt: null },
    entry(actor, 'rejected', reason),
  );
  if (!updated) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'SubscriptionDue', id, { change: 'rejected' });
  await tellChat(updated, 'rejected', `⛔ ${isAdmin(actor) ? 'Admin' : 'Accounts'} rejected ${updated.name} (${updated.number}): “${reason.slice(0, 200)}”. Please fix it and save — it comes back for check.`, { mention: [updated.addedBy] });
  return shape(updated, actor);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export const LIST_SORTS = Object.freeze({
  due: { field: 'dueDate', dir: 1, type: 'string' },
});
const SEARCH_FIELDS = Object.freeze(['number', 'name', 'purpose', 'addedByName']);

/**
 * The Mongo query for a viewer and the list's filters (exported for tests).
 * Every filter is ANDed onto the visibility rule — a team sees only its own — so
 * no combination widens what someone sees. Unknown values are ignored.
 *
 *   status  pending | verified | rejected
 *   due     week (today … 7 days on) | overdue (before today)
 *   team    accounts / admin only
 *   q       name, what for, SD number, who added it
 */
export function listQuery(actor, f = {}, now = new Date()) {
  const today = todayIst(now);
  const visible = seesAll(actor)
    ? (STAFF_TEAM_VALUES.includes(f.team) ? { team: f.team } : {})
    : { team: actor.staff.team };
  const due = f.due === 'week' ? { dueDate: { $gte: today, $lte: addDays(today, 7) } }
    : f.due === 'overdue' ? { dueDate: { $lt: today } } : null;
  return and(
    { archived: false },
    visible,
    STATUS_LABELS[f.status] ? { status: f.status } : null,
    due,
    searchClauses(searchWords(String(f.q ?? '')), SEARCH_FIELDS),
  );
}

/** A page of items, soonest due first. The first page also says how many match. */
export async function list(actor, params = {}) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  const filters = plainQuery(params);
  const { items, ...page } = await keysetPage({
    query: listQuery(actor, filters), sorts: LIST_SORTS, sortName: 'due', cursor: filters.cursor, pageSize: PAGE_SIZE,
    find: subscriptionDueRepository.page, count: (q) => subscriptionDueRepository.summary(q, SUMMARY_CAP),
  });
  const now = new Date();
  return { ...page, items: items.map((r) => shape(r, actor, { now })) };
}

/** One item with its history. */
export async function getOne(actor, id) {
  return shape(await loadVisible(actor, id), actor);
}

/** What the form offers: types, payment methods, currencies, teams (accounts / admin pick one). */
export function options(actor) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  return {
    kinds: Object.entries(KINDS).map(([value, label]) => ({ value, label })),
    methods: Object.entries(METHODS).map(([value, label]) => ({ value, label })),
    currencies: EXPENSE_CURRENCIES.map((c) => ({ code: c.code, label: c.label, approxInrPerUnit: c.code === BASE_CURRENCY ? 1 : ROUGH_INR_PER_UNIT[c.code] ?? null })),
    baseCurrency: BASE_CURRENCY,
    teams: seesAll(actor) ? STAFF_TEAM_VALUES.map((value) => ({ value, label: STAFF_TEAM_LABELS[value] })) : [],
    team: isActiveStaff(actor) ? actor.staff.team : null,
    canCheck: mayCheck(actor),
  };
}

/** One invoice, streamed through us (never a public link). */
export async function getFile(actor, id, fileId) {
  const r = await loadVisible(actor, id);
  const f = (r.files || []).find((x) => idOf(x._id) === String(fileId));
  if (!f) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(f, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: f.contentType, name: f.name || `${r.number}-invoice` };
}

export const _test = { mayChange, canSee, describeChanges, howPaid };
