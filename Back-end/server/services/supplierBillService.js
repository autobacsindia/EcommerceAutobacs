/**
 * "We owe suppliers" (owner, 2026-11-24): supplier bills we pay later — what we owe
 * each supplier, when it is due, overdue alerts, and part-payments.
 *
 * A bill is only a record of what we owe. PAYING it is the ordinary supplier
 * payment flow: "Pay" raises a supplier payment request linked to the bill
 * (paymentRequestService.createSupplierRequest with `supplierBillId`), accounts
 * approves it as usual, and the admin pays it — with that supplier's other
 * payments in one transfer (payBatch, unchanged).
 *
 * Money rules (CLAUDE.md "money is never optimistic"):
 *   - The server caps what is asked for: live requests + paid ≤ the bill, under a
 *     conditional $inc on `reservedPaise` (the SupplierDeal pattern) — two people
 *     paying at the same moment cannot together go over. A declined / cancelled
 *     request gives its share back; an edit moves it by the difference.
 *   - Paid / waiting / left are worked out from the requests; `paidPaise` /
 *     `settled` are a cache for the list, re-computed (never incremented) on every
 *     paid / declined / cancelled request and on every view, so it heals itself.
 *   - Rupees only for now (owner pick). Paise integers.
 *
 * Who: procurement and the admin add, change, cancel and pay bills; accounts sees
 * them (it approves the payments as usual — it does not check each bill).
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import supplierBillRepository from '../repositories/supplierBillRepository.js';
import supplierRepository from '../repositories/supplierRepository.js';
import counterRepository from '../repositories/counterRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { orderNumber } from './invoiceService.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { MAX_ATTACHMENTS_PER_RECORD } from '../config/attachments.js';
import { postSystemMessage } from './chatService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { and, isObjectId, keysetPage, plainQuery } from '../utils/listQuery.js';

export const SUPPLIER_BILL_FILES_FOLDER = 'supplier-bills'; // a PRIVATE prefix (storage/assetScope.js)
export const PAGE_SIZE = 25;
const SUMMARY_CAP = 2000;
const SUPPLIER_CAP = 500;
const OVERDUE_CAP = 50;
const MAX_RUPEES = 10000000; // ₹1 crore: the Payments typo guard
const DESCRIPTION_MAX = 2000;
const BILL_NUMBER_MAX = 60;

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const filled = (v) => v != null && String(v).trim() !== '';

// ── Who ───────────────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const onTeam = (u, team) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === team;
export const mayChange = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT);
export const maySee = (u) => mayChange(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
const roleOf = (u) => (isAdmin(u) ? 'admin' : u?.staff?.team || '');

const entry = (actor, action, note = '') => ({
  at: new Date(), by: actor?._id, byName: actor?.name || '', action, note: String(note || '').slice(0, 1000),
});

// ── Days (India time) and money text ─────────────────────────────────────────

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayIst = (now = new Date()) => IST_DAY.format(now);
export const dayText = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
/** "No due date" as stored (see models/SupplierBill.js): sorts last, never overdue. */
export const NO_DUE_DATE = '9999-12-31';
const hasDue = (ymd) => Boolean(ymd) && ymd !== NO_DUE_DATE;
const dueOut = (ymd) => (hasDue(ymd) ? ymd : '');
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const rupees = (paise) => `₹${fromPaise(paise).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ── Cleaning input ───────────────────────────────────────────────────────────

/** 'INV 4471' and 'inv-4471' are the same bill: case, spaces and separators folded. */
export const billKeyOf = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\-_/.#:]+/g, '');

/** The bill number as printed, or '' for none (it is optional: the bill may come later). */
function cleanBillNumber(v) {
  if (v != null && typeof v !== 'string') throw fail('The bill number must be text.', 400);
  // eslint-disable-next-line no-control-regex
  const s = String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length > BILL_NUMBER_MAX) throw fail(`Keep the bill number under ${BILL_NUMBER_MAX} characters.`, 400);
  if (!billKeyOf(s)) throw fail('The bill number needs a letter or a digit (or leave it empty).', 400);
  return s;
}
/** The number fields to store: both present, or both absent (never '' — see the model). */
const numberFields = (billNumber) => (billNumber ? { billNumber, billKey: billKeyOf(billNumber) } : {});
/** "bill INV-4471" or "bill (no number yet)". */
export const billLabel = (b) => (b.billNumber ? `bill ${b.billNumber}` : 'bill (no number yet)');

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDay(v) {
  const m = YMD.exec(String(v ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

/**
 * The due day: optional (NO_DUE_DATE when left empty), else a real calendar day within
 * a sane range (a past day is allowed — it is already overdue).
 */
export function cleanDueDate(v, now = new Date()) {
  if (!filled(v)) return NO_DUE_DATE;
  const day = realDay(v);
  if (!day) throw fail('Pick the day this bill is due.', 400);
  const today = todayIst(now);
  if (daysBetween(today, day) > 366) throw fail('That due date is more than a year away — check it.', 400);
  if (daysBetween(day, today) > 366 * 2) throw fail('That due date is more than two years ago — check it.', 400);
  return day;
}

/** The bill's own date: optional, never in the future. */
export function cleanBillDate(v, now = new Date()) {
  if (!filled(v)) return '';
  const day = realDay(v);
  if (!day) throw fail('The bill date is not a real day.', 400);
  const today = todayIst(now);
  if (day > today) throw fail('The bill date cannot be in the future.', 400);
  if (daysBetween(day, today) > 366 * 2) throw fail('That bill date is more than two years ago — check it.', 400);
  return day;
}

/** Rupees typed → paise. At least ₹1, at most the ₹1 crore typo guard, at most 2 decimals. */
export function cleanAmountPaise(v) {
  if (v != null && typeof v !== 'string' && typeof v !== 'number') throw fail('Type the bill amount in rupees (for example 26000 or 26000.50).', 400);
  const s = String(v ?? '').replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw fail('Type the bill amount in rupees (for example 26000 or 26000.50).', 400);
  const n = Number(s);
  if (!(n >= 1)) throw fail('The bill amount must be at least ₹1.', 400);
  if (n > MAX_RUPEES) throw fail('That amount is over ₹1 crore — check it.', 400);
  return toPaise(n);
}

function cleanDescription(v) {
  // eslint-disable-next-line no-control-regex
  return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, DESCRIPTION_MAX);
}

const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

async function orderLink(orderId) {
  if (!filled(orderId)) return { order: null, orderNumber: '' };
  if (!isObjectId(String(orderId))) throw fail('That order was not found.', 400);
  const order = await orderRepository.findForWorkflow(String(orderId));
  if (!order) throw fail('That order was not found.', 400);
  return { order: order._id, orderNumber: orderNumber(order) };
}

async function savedSupplier(id) {
  if (!isObjectId(String(id ?? ''))) throw fail('Pick the supplier from the list.', 400);
  const s = await supplierRepository.findById(String(id));
  if (!s) throw fail('Pick the supplier from the list.', 400);
  if (s.active === false) throw fail('This supplier is marked inactive — reactivate it in Suppliers first.', 409);
  return s;
}

// ── Files ────────────────────────────────────────────────────────────────────

const resourceTypeOf = (f) => (f.contentType === 'application/pdf' ? 'raw' : 'image');
const removeFile = (f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) });

async function storeBills(files, actor, { existing = 0 } = {}) {
  const list = (files || []).filter((f) => f?.buffer?.length);
  if (!list.length) return [];
  if (existing + list.length > MAX_ATTACHMENTS_PER_RECORD) throw fail(`A bill holds at most ${MAX_ATTACHMENTS_PER_RECORD} files.`, 400);
  const checked = checkAttachments(list, { existing, noun: 'bill' });
  return storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer,
      folder: SUPPLIER_BILL_FILES_FOLDER,
      basename: `bill-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType,
      cloudinaryPrivate: true,
    });
    return { publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes, name, uploadedBy: actor._id, uploadedAt: new Date() };
  }, removeFile);
}

async function discard(files) {
  await Promise.all((files || []).map((f) => removeFile(f).catch((err) => console.error('[SupplierBill] file clean-up failed:', err.message))));
}

// ── Chat ─────────────────────────────────────────────────────────────────────

/** Posted in procurement's and accounts' team spaces. Best-effort: chat never blocks a save. */
async function tellChat(key, message) {
  try {
    await Promise.all(['team:procurement', 'team:accounts'].map((space) => postSystemMessage(space, message, { key: `${key}-${space}` })));
  } catch (err) {
    console.error('[SupplierBill] chat update failed (ignored):', err.message);
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

const LIVE = (r) => r.status !== 'declined' && r.status !== 'cancelled';
const WAITING_LABEL = { submitted: 'Waiting for accounts', approved: 'Approved — waiting to be paid', on_hold: 'On hold' };

/** What one payment pays of a bill (rupees, in paise): what is transferred + supplier credit used on it. */
const billPaiseOf = (r) => toPaise(Number(r.amount) || 0) + toPaise(Number(r.credit?.amount) || 0);

/** What has been paid / is waiting on a bill, from its requests (paise). */
export function moneyFrom(bill, requests = []) {
  const mine = requests.filter((r) => idOf(r.supplierBill) === idOf(bill._id));
  // Supplier credit used on a payment settles the bill too: the money moved + the credit.
  const paidPaise = mine.filter((r) => r.status === 'paid').reduce((s, r) => s + billPaiseOf(r), 0);
  const waitingPaise = mine.filter((r) => LIVE(r) && r.status !== 'paid').reduce((s, r) => s + billPaiseOf(r), 0);
  return { mine, paidPaise, waitingPaise };
}

const amountKnown = (bill) => typeof bill.amountPaise === 'number';
/** Paid in full: only a bill whose amount is known can be. */
const settledBy = (bill, paidPaise) => amountKnown(bill) && paidPaise >= bill.amountPaise;

/**
 * open (nothing paid) / part_paid / paid / cancelled — plus `overdue` while something is
 * still owed and the bill has a due date that has passed.
 */
export function stateOf(bill, paidPaise, today) {
  if (bill.status === 'cancelled') return { state: 'cancelled', overdue: false };
  if (settledBy(bill, paidPaise)) return { state: 'paid', overdue: false };
  return { state: paidPaise > 0 ? 'part_paid' : 'unpaid', overdue: hasDue(bill.dueDate) && bill.dueDate < today };
}

export const STATE_LABELS = Object.freeze({ unpaid: 'Not paid', part_paid: 'Part paid', paid: 'Paid', cancelled: 'Cancelled' });

export function shape(bill, viewer, requests = [], { now = new Date(), withHistory = false } = {}) {
  const today = todayIst(now);
  const { mine, paidPaise, waitingPaise } = moneyFrom(bill, requests);
  const { state, overdue } = stateOf(bill, paidPaise, today);
  const known = amountKnown(bill);
  // Unknown amount: what is owed / left is unknown too (null), never a guessed 0.
  const owedPaise = bill.status === 'cancelled' ? 0 : known ? Math.max(0, bill.amountPaise - paidPaise) : null;
  // What can still be asked for: the bill less everything live (paid + waiting).
  const leftToAskPaise = bill.status === 'cancelled' ? 0 : known ? Math.max(0, bill.amountPaise - bill.reservedPaise) : null;
  const dueInDays = hasDue(bill.dueDate) ? daysBetween(today, bill.dueDate) : null;
  const canChange = mayChange(viewer) && bill.status === 'open';
  return {
    id: idOf(bill._id),
    number: bill.number,
    supplier: { id: idOf(bill.supplier), name: bill.supplierName },
    billNumber: bill.billNumber || '',
    billDate: bill.billDate || '',
    dueDate: dueOut(bill.dueDate),
    dueInDays,
    amount: known ? fromPaise(bill.amountPaise) : null,
    amountKnown: known,
    paid: fromPaise(paidPaise),
    waiting: fromPaise(waitingPaise),
    owed: owedPaise == null ? null : fromPaise(owedPaise),
    leftToAsk: leftToAskPaise == null ? null : fromPaise(leftToAskPaise),
    currency: 'INR',
    state,
    stateLabel: STATE_LABELS[state],
    overdue,
    description: bill.description || '',
    order: bill.order ? { id: idOf(bill.order), number: bill.orderNumber || '' } : null,
    files: (bill.files || []).map((f) => ({ id: idOf(f._id), name: f.name || 'Bill', contentType: f.contentType })),
    payments: mine.map((r) => ({
      id: idOf(r._id), number: r.number, status: r.status,
      statusLabel: r.status === 'paid' ? 'Paid' : r.status === 'declined' ? 'Declined' : r.status === 'cancelled' ? 'Cancelled' : WAITING_LABEL[r.status] || r.status,
      amount: Number(r.amount) || 0,
      // Supplier credit used on it: the bill share = amount + this.
      credit: Number(r.credit?.amount) || 0, raisedBy: r.requestedByName || '', createdAt: r.createdAt,
      paidAt: r.payment?.transactionAt || r.payment?.paidAt || null,
    })),
    createdByName: bill.createdByName || '',
    createdAt: bill.createdAt,
    rev: bill.rev || 0,
    ...(withHistory ? { history: (bill.history || []).map((h) => ({ at: h.at, byName: h.byName, action: h.action, note: h.note })) } : {}),
    can: {
      // With no amount yet, Pay first asks for it (the payment itself is refused until then).
      pay: canChange && (!known || leftToAskPaise > 0),
      edit: canChange,
      // Only while nothing is asked for or paid on it.
      cancel: canChange && bill.reservedPaise === 0,
    },
  };
}

async function loadBill(id) {
  if (!isObjectId(String(id ?? ''))) throw fail('Bill not found.', 404);
  const bill = await supplierBillRepository.findById(String(id));
  if (!bill) throw fail('Bill not found.', 404);
  return bill;
}

/**
 * Re-compute the paid cache from the requests and store it. Idempotent (sets, never
 * adds), so calling it after every paid / declined / cancelled request — and on a
 * view — can never double-count. Returns the bill as stored. Never throws.
 */
export async function resync(billOrId) {
  try {
    const bill = billOrId?._id ? billOrId : await supplierBillRepository.findById(idOf(billOrId));
    if (!bill) return null;
    const requests = await supplierBillRepository.requestsFor([bill._id]);
    const { paidPaise } = moneyFrom(bill, requests);
    const settled = settledBy(bill, paidPaise);
    if (paidPaise === (bill.paidPaise || 0) && settled === Boolean(bill.settled)) return { bill, requests };
    const now = await supplierBillRepository.setPaid(bill._id, paidPaise, settled);
    return { bill: now || bill, requests };
  } catch (err) {
    console.error(`[SupplierBill] ${idOf(billOrId)}: could not re-compute what is paid:`, err.message);
    return null;
  }
}

// ── Add / change / cancel ────────────────────────────────────────────────────

const ALREADY = (b) => `${b.supplierName}'s ${billLabel(b)} is already added (${b.number}).`;

export async function create(actor, input = {}, uploaded = [], req) {
  if (!mayChange(actor)) throw fail('Only procurement adds supplier bills.', 403);
  const s = await savedSupplier(input.supplierId);
  const billNumber = cleanBillNumber(input.billNumber);
  const billKey = billNumber ? billKeyOf(billNumber) : null;
  const billDate = cleanBillDate(input.billDate);
  const dueDate = cleanDueDate(input.dueDate);
  if (billDate && hasDue(dueDate) && dueDate < billDate) throw fail('The due date cannot be before the bill date.', 400);
  const amountPaise = filled(input.amount) ? cleanAmountPaise(input.amount) : null;
  const description = cleanDescription(input.description);
  const link = await orderLink(input.orderId);
  const clientId = cleanClientId(input.clientId);
  if (clientId) {
    const seen = await supplierBillRepository.findByClientId(actor._id, clientId);
    if (seen) return shape(seen, actor);
  }
  // Only a numbered bill can be a duplicate; bills with no number are told apart by their SB number.
  const dup = billKey && await supplierBillRepository.findOpenByKey(s._id, billKey);
  if (dup) throw fail(ALREADY(dup), 409);

  const files = await storeBills(uploaded, actor);
  let doc;
  try {
    doc = await supplierBillRepository.create({
      number: `SB-${String(await counterRepository.next('supplier_bill')).padStart(4, '0')}`,
      supplier: s._id, supplierName: s.name,
      ...numberFields(billNumber), billDate, dueDate, currency: 'INR', amountPaise,
      description, ...link, files,
      createdBy: actor._id, createdByName: actor.name || '',
      ...(clientId ? { clientId } : {}),
      history: [entry(actor, 'added', `${amountPaise == null ? 'amount not known yet' : rupees(amountPaise)}, ${hasDue(dueDate) ? `due ${dayText(dueDate)}` : 'no due date'}`)],
    });
  } catch (err) {
    await discard(files);
    if (err?.code === 11000) {
      // The same submit twice at the same moment, or the same bill added by two people.
      const seen = clientId && await supplierBillRepository.findByClientId(actor._id, clientId);
      if (seen) return shape(seen, actor);
      const other = billKey && await supplierBillRepository.findOpenByKey(s._id, billKey);
      if (other) throw fail(ALREADY(other), 409);
    }
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'SupplierBill', doc._id, { supplierId: idOf(s._id), amountPaise, dueDate: dueOut(dueDate) || null, billNumber: billNumber || null, role: roleOf(actor) });
  return shape(doc, actor);
}

const MOVED = 'Someone has just changed this bill. Refresh to see the latest, then try again.';

/**
 * Change the bill number, dates, amount, details or order; add bill files. The
 * supplier never changes (cancel and add it again). The amount can never go below
 * what is already asked for or paid — checked in the same write (compare-and-set).
 */
export async function update(actor, id, input = {}, uploaded = [], req) {
  if (!mayChange(actor)) throw fail('Only procurement changes supplier bills.', 403);
  const b0 = await loadBill(id);
  if (b0.status !== 'open') throw fail('A cancelled bill cannot be changed.', 409);
  if (input.rev != null && input.rev !== '' && Number(input.rev) !== (b0.rev || 0)) throw fail(MOVED, 409);
  if (filled(input.supplierId) && String(input.supplierId) !== idOf(b0.supplier)) {
    throw fail('The supplier on a bill cannot change — cancel this bill and add it again under the right supplier.', 400);
  }
  const set = {};
  const unset = {};
  const said = [];
  if (input.billNumber != null) {
    const billNumber = cleanBillNumber(input.billNumber);
    if (billNumber !== (b0.billNumber || '')) {
      if (billNumber) {
        Object.assign(set, numberFields(billNumber));
        // Told up front; the unique index still decides a race.
        const other = await supplierBillRepository.findOpenByKey(b0.supplier, set.billKey);
        if (other && idOf(other._id) !== idOf(b0._id)) throw fail(ALREADY(other), 409);
      }
      else Object.assign(unset, { billNumber: '', billKey: '' });
      said.push(`bill no. ${b0.billNumber || '—'} → ${billNumber || '—'}`);
    }
  }
  if (input.billDate != null) {
    const billDate = cleanBillDate(input.billDate);
    if (billDate !== (b0.billDate || '')) { set.billDate = billDate; said.push(`bill date ${dayText(b0.billDate) || '—'} → ${dayText(billDate) || '—'}`); }
  }
  if (input.dueDate != null) {
    const dueDate = cleanDueDate(input.dueDate);
    if (dueDate !== b0.dueDate) { set.dueDate = dueDate; said.push(`due ${dayText(dueOut(b0.dueDate)) || '—'} → ${dayText(dueOut(dueDate)) || '—'}`); }
  }
  const billDate = set.billDate ?? b0.billDate;
  const dueNow = set.dueDate ?? b0.dueDate;
  if (billDate && hasDue(dueNow) && dueNow < billDate) throw fail('The due date cannot be before the bill date.', 400);
  // Empty means "unchanged": an amount, once known, is corrected, never removed.
  let amountPaise = amountKnown(b0) ? b0.amountPaise : null;
  if (input.amount != null && input.amount !== '') {
    amountPaise = cleanAmountPaise(input.amount);
    if (amountPaise !== b0.amountPaise) { set.amountPaise = amountPaise; said.push(`amount ${amountKnown(b0) ? rupees(b0.amountPaise) : 'not known'} → ${rupees(amountPaise)}`); }
  }
  if (input.description != null) {
    const description = cleanDescription(input.description);
    if (description !== (b0.description || '')) { set.description = description; said.push('details'); }
  }
  if (input.orderId !== undefined) {
    const link = await orderLink(input.orderId);
    if (idOf(link.order) !== idOf(b0.order)) { Object.assign(set, link); said.push(`order ${b0.orderNumber || '—'} → ${link.orderNumber || '—'}`); }
  }
  const stored = await storeBills(uploaded, actor, { existing: (b0.files || []).length });
  if (stored.length) said.push(`${stored.length} file${stored.length > 1 ? 's' : ''} added`);
  if (!said.length) return shape(b0, actor);
  if (set.amountPaise != null) set.settled = (b0.paidPaise || 0) >= amountPaise;

  let b;
  try {
    b = await supplierBillRepository.updateIf(b0._id,
      // Same version, still open, and the new amount still covers everything asked for
      // (with no amount, nothing can have been reserved: it must still be 0).
      { rev: b0.rev || 0, status: 'open', reservedPaise: amountPaise == null ? 0 : { $lte: amountPaise } },
      {
        $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { rev: 1 },
        $push: { history: entry(actor, 'changed', said.join('; ')), ...(stored.length ? { files: { $each: stored } } : {}) },
      });
  } catch (err) {
    await discard(stored);
    if (err?.code === 11000) {
      const other = set.billKey && await supplierBillRepository.findOpenByKey(b0.supplier, set.billKey);
      throw fail(other ? ALREADY(other) : MOVED, 409);
    }
    throw err;
  }
  if (!b) {
    await discard(stored);
    const now = await supplierBillRepository.findById(b0._id);
    if (amountPaise != null && now && now.status === 'open' && (now.rev || 0) === (b0.rev || 0) && now.reservedPaise > amountPaise) {
      throw fail(`${rupees(now.reservedPaise)} is already asked for or paid on this bill — the amount cannot be less than that.`, 409);
    }
    throw fail(MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'SupplierBill', b._id, { changes: said });
  const synced = await resync(b);
  return shape(synced?.bill || b, actor, synced?.requests || []);
}

/** A bill added by mistake: marked cancelled (never deleted), only while nothing is asked for or paid on it. */
export async function cancel(actor, id, input = {}, req) {
  if (!mayChange(actor)) throw fail('Only procurement cancels supplier bills.', 403);
  const b0 = await loadBill(id);
  if (b0.status === 'cancelled') return shape(b0, actor);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) throw fail('Say why this bill is being cancelled.', 400);
  const b = await supplierBillRepository.updateIf(b0._id, { status: 'open', reservedPaise: 0 }, {
    $set: { status: 'cancelled', settled: false }, $inc: { rev: 1 }, $push: { history: entry(actor, 'cancelled', reason) },
  });
  if (!b) {
    const now = await supplierBillRepository.findById(b0._id);
    if (now?.status === 'cancelled') return shape(now, actor);
    throw fail('A payment is already raised on this bill — cancel or decline that payment first.', 409);
  }
  auditLogger.logAction(req, 'DELETE', 'SupplierBill', b._id, { cancelled: true, reason });
  return shape(b, actor);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export const LIST_SORTS = Object.freeze({ due: { field: 'dueDate', dir: 1, type: 'string' } });
export const SHOWS = Object.freeze(['owed', 'paid', 'cancelled']);

/**
 * The list's query. Unknown values are ignored.
 *   show     owed (default: open, not settled) | paid (open, settled) | cancelled
 *   due      overdue (before today) | week (today … 7 days on) — owed bills only
 *   supplier a supplier id
 */
export function listQuery(f = {}, now = new Date()) {
  const today = todayIst(now);
  const show = SHOWS.includes(f.show) ? f.show : 'owed';
  const base = show === 'cancelled' ? { status: 'cancelled' } : { status: 'open', settled: show === 'paid' };
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const due = show !== 'owed' ? null
    : f.due === 'overdue' ? { dueDate: { $lt: today } }
      : f.due === 'week' ? { dueDate: { $gte: today, $lte: week } } : null;
  return and(base, due, isObjectId(String(f.supplier ?? '')) ? { supplier: new mongoose.Types.ObjectId(String(f.supplier)) } : null);
}

/** A page of bills, soonest due first, with their payments (one query for the page). */
export async function list(actor, params = {}) {
  if (!maySee(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const now = new Date();
  const { items, ...page } = await keysetPage({
    query: listQuery(f, now), sorts: LIST_SORTS, sortName: 'due', cursor: f.cursor, pageSize: PAGE_SIZE,
    find: supplierBillRepository.page, count: (q) => supplierBillRepository.summary(q, SUMMARY_CAP),
  });
  const requests = items.length ? await supplierBillRepository.requestsFor(items.map((b) => b._id)) : [];
  const summary = page.summary ? { ...page.summary, owed: page.summary.owedPaise == null ? null : fromPaise(page.summary.owedPaise) } : undefined;
  if (summary) delete summary.owedPaise;
  return { ...page, ...(summary ? { summary } : {}), bills: items.map((b) => shape(b, actor, requests, { now })) };
}

/** What we owe each supplier (bills not yet paid), most overdue first. */
export async function bySupplier(actor, now = new Date()) {
  if (!maySee(actor)) throw fail('Not authorized.', 403);
  const rows = await supplierBillRepository.owedBySupplier(todayIst(now), SUPPLIER_CAP);
  const suppliers = rows.map((r) => ({
    id: idOf(r._id), name: r.name, bills: r.bills,
    owed: fromPaise(r.owedPaise), noAmountBills: r.noAmountBills || 0,
    overdueBills: r.overdueBills, overdue: fromPaise(r.overduePaise), nextDue: dueOut(r.nextDue),
  }));
  return {
    suppliers,
    total: { owed: fromPaise(rows.reduce((s, r) => s + r.owedPaise, 0)), overdue: fromPaise(rows.reduce((s, r) => s + r.overduePaise, 0)) },
  };
}

export async function getOne(actor, id) {
  if (!maySee(actor)) throw fail('Not authorized.', 403);
  const bill = await loadBill(id);
  const synced = await resync(bill);
  const requests = synced?.requests || await supplierBillRepository.requestsFor([bill._id]);
  return shape(synced?.bill || bill, actor, requests, { withHistory: true });
}

export async function getFile(actor, id, fileId) {
  if (!maySee(actor)) throw fail('Not authorized.', 403);
  const bill = await loadBill(id);
  const f = (bill.files || []).find((x) => idOf(x._id) === String(fileId));
  if (!f) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(f, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: f.contentType, name: f.name || `${bill.number}-bill` };
}

// ── Paying (called by paymentRequestService) ─────────────────────────────────

/** The bill a new payment is for: open and with something left to ask for. */
export async function billForPayment(id) {
  const bill = await loadBill(id);
  if (bill.status !== 'open') throw fail('This bill was cancelled.', 409);
  if (!amountKnown(bill)) throw fail(`Add the bill amount to ${bill.number} first (Edit the bill), then pay it.`, 409);
  if (bill.reservedPaise >= bill.amountPaise) throw fail(`The whole ${rupees(bill.amountPaise)} of this bill is already asked for or paid.`, 409);
  return bill;
}

/** Reserve `paise` of the bill for a payment (one conditional $inc). Throws 409 when it would go over. */
export async function reserve(id, paise) {
  const before = await supplierBillRepository.reserve(id, paise);
  if (before) return before;
  const now = await supplierBillRepository.findById(id);
  if (!now || now.status !== 'open') throw fail('This bill was cancelled.', 409);
  if (!amountKnown(now)) throw fail(`Add the bill amount to ${now.number} first (Edit the bill), then pay it.`, 409);
  const left = Math.max(0, now.amountPaise - now.reservedPaise);
  throw fail(left
    ? `That is more than is left on the bill. Only ${rupees(left)} of ${rupees(now.amountPaise)} is left to pay.`
    : `The whole ${rupees(now.amountPaise)} of this bill is already asked for or paid.`, 409);
}

/** Give a reservation back (the payment was declined / cancelled, or failed to save). Never throws. */
export async function release(id, paise, reason = '') {
  if (!id || !(paise > 0)) return;
  try {
    await supplierBillRepository.release(id, paise);
  } catch (err) {
    console.error(`[SupplierBill] ${idOf(id)}: could not release ${paise} paise (${reason}):`, err.message);
  }
}

// ── Daily overdue reminder (cronService) ─────────────────────────────────────

/**
 * One message a day in procurement's and accounts' spaces listing the supplier
 * bills past due and not fully paid. Keyed by the day, so a re-run (a restart, a
 * second instance) posts once. Quiet when nothing is overdue.
 */
export async function remindOverdue(now = new Date()) {
  const today = todayIst(now);
  const bills = await supplierBillRepository.findOverdue(today, OVERDUE_CAP + 1);
  if (!bills.length) return { day: today, overdue: 0, posted: false };
  const shown = bills.slice(0, OVERDUE_CAP);
  const lines = shown.map((b) => {
    const late = daysBetween(b.dueDate, today);
    const owed = amountKnown(b) ? `${rupees(b.amountPaise - (b.paidPaise || 0))} owed` : 'amount not known yet';
    return `• ${b.supplierName} — ${billLabel(b)} (${b.number}): ${owed}, due ${dayText(b.dueDate)} (${late} day${late === 1 ? '' : 's'} late)`;
  });
  const more = bills.length > OVERDUE_CAP ? `\n…and more — see Payments → We owe suppliers.` : '';
  await tellChat(`supplier-bills-overdue-${today}`,
    `⏰ Supplier bills overdue (${bills.length > OVERDUE_CAP ? `${OVERDUE_CAP}+` : bills.length}):\n${lines.join('\n')}${more}\nProcurement: raise the payment from Payments → We owe suppliers.`);
  return { day: today, overdue: bills.length, posted: true };
}

export const _test = { hasDue, billKeyOf, cleanAmountPaise, cleanDueDate, cleanBillDate, stateOf, moneyFrom, listQuery };
