import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import supplierLedgerRepository, { LEDGER_SIGN } from '../repositories/supplierLedgerRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import supplierRepository from '../repositories/supplierRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { keysetPage, plainQuery } from '../utils/listQuery.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { itemsCancelled } from './supplierAdvanceGuard.js';

/**
 * Supplier credit — what a supplier owes us, kept as an immutable ledger
 * (models/SupplierLedgerEntry.js). The owner's example:
 *
 *   We paid the supplier ₹30,000; the customer's order was cancelled.
 *     procurement: "Supplier must refund ₹30,000"          refund_due  (pending)
 *     accounts approves                                     owes us ₹30,000
 *   The supplier pays back ₹15,000 (UTR …).
 *     procurement records it, accounts approves             owes us ₹15,000
 *   Next order from them, ₹40,000: use ₹15,000 credit       credit_used → we transfer ₹25,000
 *   That payment declined / cancelled → the ₹15,000 comes back (credit_restored).
 *
 * Rules (owner, 2026-11-06):
 *   • What the supplier owes is credit at once — no separate "convert" step.
 *   • Procurement proposes; accounts (or the admin) approves. Nobody approves their own
 *     entry except the admin.
 *   • A repayment / write-off can never take the balance below zero; credit used can
 *     never be more than the balance — checked under the supplier's lock, in a transaction.
 *   • One currency at a time: THB credit pays only THB bills.
 *   • Every action is idempotent: one row per cause (unique `key`).
 *
 * Amounts in and out of this module are in units of the currency (rupees, baht);
 * everything inside is integer hundredths ("paise").
 */

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const BASE_CURRENCY = 'INR';

const isAdmin = (u) => u?.role === 'admin';
const onTeam = (u, team) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === team;
const isProcurement = (u) => onTeam(u, STAFF_TEAMS.PROCUREMENT);
const isAccounts = (u) => onTeam(u, STAFF_TEAMS.ACCOUNTS);
export const maySeeCredit = (u) => isAdmin(u) || isProcurement(u) || isAccounts(u);
export const mayPropose = (u) => isAdmin(u) || isProcurement(u);
export const mayDecide = (u) => isAdmin(u) || isAccounts(u);

export const KIND_LABELS = Object.freeze({
  refund_due: 'Refund due',
  repaid: 'Supplier paid back',
  credit_used: 'Credit used on a payment',
  credit_restored: 'Credit given back',
  written_off: 'Written off',
});
export const STATUS_LABELS = Object.freeze({
  pending: 'Waiting for accounts', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled',
});

export const MAX_CREDIT_AMOUNT = 1000000000; // a typo guard in any currency, not a business limit
const PAGE_SIZE = 50;
const OWING_LIMIT = 200;
const REPORT_LIMIT = 5000;

export const moneyOf = (paise, currency = BASE_CURRENCY) => {
  const n = fromPaise(paise).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return currency === BASE_CURRENCY ? `₹${n}` : `${currency} ${n}`;
};

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** A typed amount → paise. 0.01 or more, at most two decimals' worth. */
export function cleanAmountPaise(value) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n <= 0) throw fail('Enter an amount more than 0.', 400);
  if (n > MAX_CREDIT_AMOUNT) throw fail('That amount looks too large — check it.', 400);
  const paise = toPaise(n);
  if (paise < 1) throw fail('Enter an amount more than 0.', 400);
  return paise;
}

const cleanCurrency = (v) => {
  const c = text(v || BASE_CURRENCY, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw fail('Choose a currency.', 400);
  return c;
};

/** A browser-made id for one form submit: a retried or double-clicked submit saves once. */
function cleanFormKey(v) {
  const k = text(v, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw fail('This form is out of date — refresh the page and try again.', 400);
  return k;
}

/** 'YYYY-MM-DD', not in the future, within a year. */
function cleanDay(v, now = Date.now()) {
  const d = text(v, 10);
  // Round-trip: 2026-02-30 parses (as 2 March) but is not a real day.
  const real = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
    && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!real) throw fail('Enter the date the money came back.', 400);
  const t = Date.parse(`${d}T00:00:00+05:30`);
  if (t > now + 86400000) throw fail('That date is in the future.', 400);
  if (t < now - 366 * 86400000) throw fail('That date is more than a year ago — check it.', 400);
  return d;
}

const isDuplicate = (err) => err?.code === 11000 || /E11000/.test(String(err?.message));
const historyEntry = (actor, action, note = '') => ({
  at: new Date(), by: actor?._id || null, byName: actor?.name || (actor ? '' : 'System'), action, note: text(note, 1000),
});

// ── Balances ─────────────────────────────────────────────────────────────────

/** [{ currency, owedPaise, pendingPaise }] from the repository's rows, biggest first. */
const balanceRows = (rows) => rows
  .map((r) => ({ currency: (r._id?.currency ?? r._id) || BASE_CURRENCY, owedPaise: r.owedPaise || 0, pendingPaise: r.pendingPaise || 0 }))
  .filter((r) => r.owedPaise !== 0 || r.pendingPaise !== 0)
  .sort((a, b) => b.owedPaise - a.owedPaise);

/** What the supplier owes us in `currency` right now, in paise (approved rows only). */
export async function owedPaise(supplierId, currency, session = null) {
  const rows = await supplierLedgerRepository.balances(supplierId, session);
  return rows.find((r) => (r._id || BASE_CURRENCY) === currency)?.owedPaise || 0;
}

const balanceView = (b) => ({
  currency: b.currency,
  owed: fromPaise(b.owedPaise),
  owedText: moneyOf(b.owedPaise, b.currency),
  // Waiting for accounts, signed: + a claim not approved yet, − a repayment not approved yet.
  pending: fromPaise(b.pendingPaise),
  pendingText: b.pendingPaise ? moneyOf(Math.abs(b.pendingPaise), b.currency) : '',
});

/** For several suppliers (the directory page): Map supplierId → [balanceView]. One aggregate. */
export async function balancesForSuppliers(supplierIds) {
  const ids = [...new Set(supplierIds.map(idOf).filter(isId))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await supplierLedgerRepository.balancesFor(ids);
  for (const r of rows) {
    const sid = idOf(r._id.supplier);
    const list = out.get(sid) || [];
    list.push({ currency: r._id.currency || BASE_CURRENCY, owedPaise: r.owedPaise || 0, pendingPaise: r.pendingPaise || 0 });
    out.set(sid, list);
  }
  for (const [sid, list] of out) out.set(sid, balanceRows(list.map((b) => ({ _id: b.currency, ...b }))).map(balanceView));
  return out;
}

// ── Shape ────────────────────────────────────────────────────────────────────

export function shape(e, viewer) {
  const mine = idOf(e.createdBy) === idOf(viewer?._id);
  const pending = e.status === 'pending';
  return {
    id: idOf(e._id),
    kind: e.kind,
    kindLabel: KIND_LABELS[e.kind] || e.kind,
    status: e.status,
    statusLabel: STATUS_LABELS[e.status] || e.status,
    supplier: { id: idOf(e.supplier), name: e.supplierName || '' },
    currency: e.currency || BASE_CURRENCY,
    amount: fromPaise(e.amountPaise),
    // + the supplier owes us more, − less.
    signedAmount: fromPaise(e.amountPaise * (LEDGER_SIGN[e.kind] || 0)),
    amountText: moneyOf(e.amountPaise, e.currency),
    order: e.order ? { id: idOf(e.order), number: e.orderNumber || '' } : null,
    paymentRequest: e.paymentRequest ? { id: idOf(e.paymentRequest), number: e.paymentRequestNumber || '' } : null,
    date: e.date || '',
    reference: e.reference || '',
    note: e.note || '',
    createdByName: e.createdByName || '',
    createdAt: e.createdAt,
    decidedByName: e.decidedByName || '',
    decidedAt: e.decidedAt || null,
    decisionNote: e.decisionNote || '',
    history: (e.history || []).map((h) => ({ at: h.at, byName: h.byName, action: h.action, note: h.note })),
    can: {
      approve: pending && mayDecide(viewer) && (!mine || isAdmin(viewer)),
      decline: pending && mayDecide(viewer),
      cancel: pending && (mine || isAdmin(viewer)),
    },
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function loadSupplier(id) {
  if (!isId(id)) throw fail('Supplier not found.', 404);
  const s = await supplierRepository.findById(id);
  if (!s) throw fail('Supplier not found.', 404);
  return s;
}

export const LEDGER_SORTS = Object.freeze({ newest: { field: 'createdAt', dir: -1, type: 'date' } });

/** A supplier's balance (per currency) and its history, newest first, a cursor page at a time. */
export async function forSupplier(actor, supplierId, params = {}) {
  if (!maySeeCredit(actor)) throw fail('Not authorized.', 403);
  const s = await loadSupplier(supplierId);
  const f = plainQuery(params);
  const [page, rows] = await Promise.all([
    keysetPage({
      query: { supplier: s._id }, sorts: LEDGER_SORTS, sortName: 'newest', cursor: f.after, pageSize: PAGE_SIZE,
      find: supplierLedgerRepository.page,
    }),
    f.after ? null : supplierLedgerRepository.balances(s._id),
  ]);
  return {
    supplier: { id: idOf(s._id), name: s.name },
    ...(rows ? { balances: balanceRows(rows).map(balanceView) } : {}),
    entries: page.items.map((e) => shape(e, actor)),
    nextAfter: page.nextCursor,
    can: { propose: mayPropose(actor), writeOff: isAdmin(actor) },
  };
}

/** Accounts' queue: everything waiting for a decision, newest first. */
export async function pending(actor, params = {}) {
  if (!maySeeCredit(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const page = await keysetPage({
    query: { status: 'pending' }, sorts: LEDGER_SORTS, sortName: 'newest', cursor: f.after, pageSize: PAGE_SIZE,
    find: supplierLedgerRepository.page,
  });
  return { entries: page.items.map((e) => shape(e, actor)), nextAfter: page.nextCursor };
}

/** Every supplier who owes us something (or has something waiting), biggest first. */
export async function owing(actor) {
  if (!maySeeCredit(actor)) throw fail('Not authorized.', 403);
  const rows = await supplierLedgerRepository.owing(OWING_LIMIT);
  return {
    suppliers: rows.map((r) => ({
      supplier: { id: idOf(r._id.supplier), name: r.supplierName || '' },
      ...balanceView({ currency: r._id.currency || BASE_CURRENCY, owedPaise: r.owedPaise || 0, pendingPaise: r.pendingPaise || 0 }),
    })),
    capped: rows.length >= OWING_LIMIT,
  };
}

/** The open claim (if any) on each paid payment → Map requestId → { status, amount, currency }. */
export async function claimsFor(requestIds) {
  const ids = requestIds.map(idOf).filter(isId).map((id) => new mongoose.Types.ObjectId(id));
  const out = new Map();
  if (!ids.length) return out;
  for (const c of await supplierLedgerRepository.claimsFor(ids)) {
    out.set(idOf(c.paymentRequest), { id: idOf(c._id), status: c.status, amount: fromPaise(c.amountPaise), currency: c.currency });
  }
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Every entry raised in a date range (IST days, at most a year), as CSV, oldest first.
 * Bounded: at most REPORT_LIMIT rows — the last line says when it was cut short.
 */
export async function report(actor, params = {}, req = null) {
  if (!maySeeCredit(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? Date.parse(`${v}T00:00:00+05:30`) : NaN);
  const from = day(f.from);
  const to = day(f.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) throw fail('Choose a from and a to date.', 400);
  if (to - from > 366 * 86400000) throw fail('Choose at most a year.', 400);
  const rows = await supplierLedgerRepository.page(
    // status $in rides supplier_ledger_status (one range per status, merged).
    { status: { $in: ['pending', 'approved', 'declined', 'cancelled'] }, createdAt: { $gte: new Date(from), $lt: new Date(to + 86400000) } },
    { sort: { createdAt: 1, _id: 1 }, limit: REPORT_LIMIT + 1 },
  );
  const head = ['Date', 'Supplier', 'What', 'Status', 'Currency', 'Amount', 'Owes us +/-', 'Order', 'Payment', 'Repaid on', 'Reference', 'Note', 'Raised by', 'Decided by'];
  const ist = (d) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
  const lines = [head.join(',')];
  for (const e of rows.slice(0, REPORT_LIMIT)) {
    lines.push([
      ist(e.createdAt), e.supplierName, KIND_LABELS[e.kind], STATUS_LABELS[e.status], e.currency,
      fromPaise(e.amountPaise).toFixed(2), e.status === 'approved' ? fromPaise(e.amountPaise * LEDGER_SIGN[e.kind]).toFixed(2) : '0.00',
      e.orderNumber, e.paymentRequestNumber, e.date, e.reference, e.note, e.createdByName, e.decidedByName,
    ].map(csvCell).join(','));
  }
  if (rows.length > REPORT_LIMIT) lines.push(csvCell(`Only the first ${REPORT_LIMIT} rows — choose a shorter range for the rest.`));
  auditLogger.logAction(req, 'EXPORT', 'SupplierLedgerEntry', null, { from: f.from, to: f.to, rows: Math.min(rows.length, REPORT_LIMIT) });
  return `${lines.join('\n')}\n`;
}

// ── Propose ──────────────────────────────────────────────────────────────────

/** Insert a row; when its key already exists (a retry), return that row instead. */
async function insertOnce(doc, session = null) {
  try {
    return { entry: await supplierLedgerRepository.create(doc, session), created: true };
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const existing = await supplierLedgerRepository.findByKey(doc.key, session);
    if (!existing) throw err;
    return { entry: existing, created: false };
  }
}

/**
 * "Supplier must refund": we paid this supplier for items the customer then cancelled.
 * A claim for at most what the payment was for (the bill — credit used on it counts),
 * one live claim per payment. Waits for accounts.
 */
export async function claimRefund(actor, requestId, input = {}, req) {
  if (!mayPropose(actor)) throw fail('Only procurement raises a supplier refund.', 403);
  if (!isId(requestId)) throw fail('Payment not found.', 404);
  const r = await paymentRequestRepository.findById(requestId);
  if (!r || r.kind !== 'supplier') throw fail('Payment not found.', 404);
  if (r.status !== 'paid') throw fail(`${r.number} is not paid — there is nothing for the supplier to refund. Cancel or decline it instead.`, 409);
  if (!r.supplier) {
    throw fail(`${r.number} was paid to details typed for that payment, not a saved supplier — save ${r.payee?.name || 'the supplier'} in the directory and pick it before raising a refund.`, 409);
  }
  const order = r.order ? await orderRepository.findForWorkflow(idOf(r.order)) : null;
  if (!r.order || !itemsCancelled(order, r.itemIds)) {
    throw fail(`${r.number}: the item is not cancelled — a refund is raised only when the customer's order (or the item) was cancelled.`, 409);
  }
  const currency = r.currency || BASE_CURRENCY;
  const billPaise = toPaise((currency === BASE_CURRENCY ? Number(r.amount) || 0 : Number(r.foreignAmount) || 0) + (Number(r.credit?.amount) || 0));
  const amountPaise = input.amount == null || input.amount === '' ? billPaise : cleanAmountPaise(input.amount);
  if (amountPaise > billPaise) throw fail(`The refund cannot be more than what ${r.number} was for (${moneyOf(billPaise, currency)}).`, 400);
  const s = await supplierRepository.findById(r.supplier);
  const { entry, created } = await insertOnce({
    supplier: r.supplier,
    supplierName: s?.name || r.payee?.name || '',
    kind: 'refund_due',
    currency,
    amountPaise,
    status: 'pending',
    key: `due:${idOf(r._id)}`,
    order: r.order,
    orderNumber: r.orderNumber || '',
    paymentRequest: r._id,
    paymentRequestNumber: r.number,
    note: text(input.note, 1000),
    createdBy: actor._id,
    createdByName: actor.name || '',
    history: [historyEntry(actor, 'raised', input.note)],
  });
  if (!created && entry.paymentRequest && idOf(entry.paymentRequest) === idOf(r._id) && ['pending', 'approved'].includes(entry.status)) {
    // A double-click: the claim already exists — the same answer, not a second claim.
    return shape(entry, actor);
  }
  if (created) auditLogger.logAction(req, 'CREATE', 'SupplierLedgerEntry', entry._id, { kind: 'refund_due', amountPaise, currency, paymentRequest: idOf(r._id) });
  return shape(entry, actor);
}

/**
 * The supplier paid money back (bank / UPI, with its date and reference). Waits for
 * accounts; the balance check is repeated under the lock when it is approved.
 */
export async function recordRepayment(actor, supplierId, input = {}, req) {
  if (!mayPropose(actor)) throw fail('Only procurement records a supplier repayment.', 403);
  const s = await loadSupplier(supplierId);
  const currency = cleanCurrency(input.currency);
  const amountPaise = cleanAmountPaise(input.amount);
  const key = `repaid:${cleanFormKey(input.formKey)}`;
  const date = cleanDay(input.date);
  const owed = await owedPaise(s._id, currency);
  if (amountPaise > owed) {
    throw fail(owed > 0
      ? `${s.name} owes us ${moneyOf(owed, currency)} — a repayment cannot be more than that.`
      : `${s.name} owes us nothing in ${currency}.`, 409);
  }
  const { entry, created } = await insertOnce({
    supplier: s._id, supplierName: s.name, kind: 'repaid', currency, amountPaise, status: 'pending', key,
    date, reference: text(input.reference, 120), note: text(input.note, 1000),
    createdBy: actor._id, createdByName: actor.name || '',
    history: [historyEntry(actor, 'raised', input.note)],
  });
  if (created) auditLogger.logAction(req, 'CREATE', 'SupplierLedgerEntry', entry._id, { kind: 'repaid', amountPaise, currency, supplier: idOf(s._id) });
  return shape(entry, actor);
}

/** The admin gives up on (part of) what a supplier owes. Takes effect at once. */
export async function writeOff(actor, supplierId, input = {}, req) {
  if (!isAdmin(actor)) throw fail('Only the admin writes off what a supplier owes.', 403);
  const s = await loadSupplier(supplierId);
  const currency = cleanCurrency(input.currency);
  const amountPaise = cleanAmountPaise(input.amount);
  const key = `writeoff:${cleanFormKey(input.formKey)}`;
  const note = text(input.note, 1000);
  if (!note) throw fail('Say why it is written off.', 400);
  const done = await supplierLedgerRepository.inTransaction(async (session) => {
    const existing = await supplierLedgerRepository.findByKey(key, session);
    if (existing) return { entry: existing, created: false };
    await supplierLedgerRepository.lockSupplier(s._id, session);
    const owed = await owedPaise(s._id, currency, session);
    if (amountPaise > owed) throw fail(`${s.name} owes us ${moneyOf(owed, currency)} — you cannot write off more than that.`, 409);
    const entry = await supplierLedgerRepository.create({
      supplier: s._id, supplierName: s.name, kind: 'written_off', currency, amountPaise, status: 'approved', key, note,
      createdBy: actor._id, createdByName: actor.name || '',
      decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(),
      history: [historyEntry(actor, 'written off', note)],
    }, session);
    return { entry, created: true };
  });
  if (done.created) auditLogger.logAction(req, 'CREATE', 'SupplierLedgerEntry', done.entry._id, { kind: 'written_off', amountPaise, currency, supplier: idOf(s._id) });
  return shape(done.entry, actor);
}

// ── Decide ───────────────────────────────────────────────────────────────────

const MOVED = 'This entry has just been decided by someone else. Refresh to see where it is now.';
/** A declined / cancelled entry gives up its key so a corrected one can be raised. */
const retiredKey = (e, how) => `${e.key}#${how}:${idOf(e._id)}`;

async function loadEntry(id) {
  if (!isId(id)) throw fail('Entry not found.', 404);
  const e = await supplierLedgerRepository.findById(id);
  if (!e) throw fail('Entry not found.', 404);
  return e;
}

export async function approve(actor, id, { note } = {}, req) {
  if (!mayDecide(actor)) throw fail('Only accounts approves supplier credit.', 403);
  const e0 = await loadEntry(id);
  if (e0.status !== 'pending') throw fail(MOVED, 409);
  if (idOf(e0.createdBy) === idOf(actor._id) && !isAdmin(actor)) throw fail('Someone else in accounts has to approve what you raised.', 403);
  const update = {
    $set: { status: 'approved', decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(), decisionNote: text(note, 1000) },
    $push: { history: historyEntry(actor, 'approved', note) },
  };
  const e = LEDGER_SIGN[e0.kind] < 0
    // Taking the balance down: check it under the supplier's lock, so two approvals
    // at once cannot both fit into the same balance.
    ? await supplierLedgerRepository.inTransaction(async (session) => {
      await supplierLedgerRepository.lockSupplier(e0.supplier, session);
      const owed = await owedPaise(e0.supplier, e0.currency, session);
      if (e0.amountPaise > owed) {
        throw fail(`${e0.supplierName} now owes us ${moneyOf(owed, e0.currency)} — this ${moneyOf(e0.amountPaise, e0.currency)} cannot be approved. Decline it, and raise the right amount.`, 409);
      }
      return supplierLedgerRepository.decide(e0._id, ['pending'], update, session);
    })
    : await supplierLedgerRepository.decide(e0._id, ['pending'], update);
  if (!e) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'APPROVE', 'SupplierLedgerEntry', e._id, { kind: e.kind, amountPaise: e.amountPaise, currency: e.currency });
  return shape(e, actor);
}

async function close(actor, e0, status, note, req) {
  const e = await supplierLedgerRepository.decide(e0._id, ['pending'], {
    $set: {
      status, key: retiredKey(e0, status),
      ...(status === 'declined' ? { decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(), decisionNote: text(note, 1000) } : {}),
    },
    $push: { history: historyEntry(actor, status, note) },
  });
  if (!e) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'SupplierLedgerEntry', e._id, { status, kind: e.kind });
  return shape(e, actor);
}

export async function decline(actor, id, { note } = {}, req) {
  if (!mayDecide(actor)) throw fail('Only accounts declines supplier credit.', 403);
  const e0 = await loadEntry(id);
  if (e0.status !== 'pending') throw fail(MOVED, 409);
  if (!text(note, 1000)) throw fail('Say why it is declined.', 400);
  return close(actor, e0, 'declined', note, req);
}

export async function cancel(actor, id, { note } = {}, req) {
  const e0 = await loadEntry(id);
  if (idOf(e0.createdBy) !== idOf(actor._id) && !isAdmin(actor)) throw fail('Only whoever raised it (or the admin) can cancel it.', 403);
  if (e0.status !== 'pending') throw fail(MOVED, 409);
  return close(actor, e0, 'cancelled', note, req);
}

// ── Use / restore (called by paymentRequestService) ──────────────────────────

/**
 * Checks before a payment that uses credit is saved (no lock: useCredit re-checks under it).
 * Returns the paise to use. `billPaise` is what the bill is for, before credit.
 */
export async function checkCreditUse({ supplierId, currency, creditInput, billPaise }) {
  const creditPaise = cleanAmountPaise(creditInput);
  if (!supplierId) throw fail('Supplier credit can only be used with a saved supplier — pick the supplier from the directory.', 400);
  if (creditPaise >= billPaise) {
    throw fail(`Credit used must be less than the bill (${moneyOf(billPaise, currency)}) — something has to be transferred.`, 400);
  }
  const owed = await owedPaise(supplierId, currency);
  if (creditPaise > owed) {
    throw fail(owed > 0
      ? `This supplier's credit in ${currency} is ${moneyOf(owed, currency)} — you cannot use more than that.`
      : `This supplier has no credit in ${currency}. Credit is used only in the currency it was owed in.`, 409);
  }
  return creditPaise;
}

/**
 * Spend credit on a payment, inside the caller's transaction: lock the supplier,
 * re-check the balance, write the `credit_used` row (key `use:<request>`).
 */
export async function useCredit(session, { supplierId, currency, creditPaise, request, actor }) {
  const s = await supplierLedgerRepository.lockSupplier(supplierId, session);
  if (!s) throw fail('Supplier not found.', 404);
  const owed = await owedPaise(supplierId, currency, session);
  if (creditPaise > owed) {
    throw fail(`This supplier's credit in ${currency} is now ${moneyOf(owed, currency)} — someone used it a moment ago. Change the credit and try again.`, 409);
  }
  return supplierLedgerRepository.create({
    supplier: supplierId, supplierName: s.name, kind: 'credit_used', currency, amountPaise: creditPaise, status: 'approved',
    key: `use:${idOf(request._id)}`,
    order: request.order || null, orderNumber: request.orderNumber || '',
    paymentRequest: request._id, paymentRequestNumber: request.number,
    createdBy: actor?._id || null, createdByName: actor?.name || '',
    decidedBy: actor?._id || null, decidedByName: actor?.name || '', decidedAt: new Date(),
    history: [historyEntry(actor, 'used', `on ${request.number}`)],
  }, session);
}

/**
 * A payment that used credit was declined / cancelled / withdrawn: give the credit
 * back (key `restore:<request>`, so it happens once). Never throws — a failure is
 * logged loudly, and running it again later restores it exactly once.
 */
export async function restoreCredit(request, note = '') {
  if (!request?.credit?.amount || !request.supplier) return null;
  try {
    const amountPaise = toPaise(request.credit.amount);
    const { entry, created } = await insertOnce({
      supplier: request.supplier, supplierName: request.payee?.name || '', kind: 'credit_restored',
      currency: request.currency || BASE_CURRENCY, amountPaise, status: 'approved',
      key: `restore:${idOf(request._id)}`,
      order: request.order || null, orderNumber: request.orderNumber || '',
      paymentRequest: request._id, paymentRequestNumber: request.number || '',
      decidedAt: new Date(), decidedByName: 'System',
      history: [historyEntry(null, 'given back', text(note, 1000))],
    });
    if (created) console.info(`[SupplierCredit] ${request.number}: ${moneyOf(amountPaise, entry.currency)} credit given back (${note})`);
    return entry;
  } catch (err) {
    console.error(`[SupplierCredit] ${request.number}: CREDIT NOT GIVEN BACK — fix by hand:`, err.message);
    return null;
  }
}

export default {
  forSupplier, pending, owing, report, claimRefund, recordRepayment, writeOff, approve, decline, cancel,
  checkCreditUse, useCredit, restoreCredit, claimsFor, balancesForSuppliers, owedPaise, shape,
};
