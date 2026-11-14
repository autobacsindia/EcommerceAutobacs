/**
 * The supplier directory — saved once by procurement, picked from a list when a
 * supplier payment is raised (services/paymentRequestService.js).
 *
 * ── WHO DOES WHAT (enforced here; the UI only reflects it) ──────────────────────
 *   add / edit / deactivate    procurement (and admin)
 *   see                        procurement, accounts, admin
 *   full account number        procurement and admin (to check it); accounts sees
 *                              the last 4 here and the full number on the payment
 *
 * Editing where the money goes stamps bankChangedAt, and payments raised soon
 * after carry a warning — see BANK_CHANGE_WARN_DAYS.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import supplierRepository from '../repositories/supplierRepository.js';
import { decryptField } from '../utils/fieldEncryption.js';
import { cleanPayee, maskAccount } from '../utils/payee.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { and, keysetPage, plainQuery, searchClauses, searchWords } from '../utils/listQuery.js';
import { cleanRichTextWithin } from '../utils/richText.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
// Notes may be formatted (utils/richText.js); the limit counts the words, not the markup.
const NOTES_MAX = 1000;
function cleanNotes(raw) {
  const { value, tooLong } = cleanRichTextWithin(raw, NOTES_MAX);
  if (tooLong) throw fail(`The notes are too long (${NOTES_MAX} characters at most).`, 400);
  return value;
}
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** A payment raised this soon after a bank-detail change carries a warning. */
export const BANK_CHANGE_WARN_DAYS = 30;
const PAGE_SIZE = 50;

const isAdmin = (u) => u?.role === 'admin';
const onTeam = (u, team) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === team;
export const mayEditSuppliers = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT);
const maySeeSuppliers = (u) => mayEditSuppliers(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);

export const nameKeyOf = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const GSTIN = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The supplier's details, checked. Payment details go through the same check as a payment. */
function cleanSupplier(input = {}) {
  const name = text(input.name, 120).replace(/\s+/g, ' ');
  if (name.length < 2) throw fail('Enter the supplier\'s name.', 400);
  const gstin = text(input.gstin, 15).toUpperCase();
  if (gstin && !GSTIN.test(gstin)) throw fail('That GST number does not look right (15 characters, e.g. 32ABCDE1234F1Z5).', 400);
  const email = text(input.email, 160).toLowerCase();
  if (email && !EMAIL.test(email)) throw fail('Enter a valid email address, or leave it empty.', 400);
  return {
    name,
    nameKey: nameKeyOf(name),
    contactPerson: text(input.contactPerson, 120),
    phone: text(input.phone, 20),
    email,
    gstin,
    address: text(input.address, 500),
    notes: cleanNotes(input.notes),
    payment: cleanPayment(input.payment, name),
  };
}

/** How we pay them: bank, UPI, or 'none' (not known yet — e.g. saved from a price enquiry). */
function cleanPayment(raw, name) {
  if (raw?.method === 'none') {
    return { method: 'none', upiId: '', accountName: '', accountNumber: '', accountLast4: '', ifsc: '', swift: '', bankName: '' };
  }
  const payee = cleanPayee({ ...(raw || {}), name });
  return payee.method === 'upi'
    ? { method: 'upi', upiId: payee.upiId, accountName: '', accountNumber: '', accountLast4: '', ifsc: '', swift: '', bankName: '' }
    : {
      method: 'bank', upiId: '', accountName: payee.accountName, accountNumber: payee.accountNumber,
      accountLast4: payee.accountNumber.slice(-4), ifsc: payee.ifsc, swift: payee.swift, bankName: payee.bankName,
    };
}

/** Where the money goes — the fields whose change is worth a warning. */
const destination = (p = {}) => [p.method, p.upiId, p.accountNumber, p.ifsc, p.swift].map((v) => String(v || '')).join('|');

const plainAccount = (s) => (s?.payment?.accountNumber ? decryptField(s.payment.accountNumber) : '');

/** What the panel shows. The full account number only to those who edit it. */
export function shape(s, viewer) {
  const full = mayEditSuppliers(viewer);
  const account = full ? plainAccount(s) : '';
  return {
    id: idOf(s._id),
    name: s.name,
    contactPerson: s.contactPerson || '',
    phone: s.phone || '',
    email: s.email || '',
    gstin: s.gstin || '',
    address: s.address || '',
    notes: s.notes || '',
    payment: {
      method: s.payment?.method,
      upiId: s.payment?.upiId || '',
      accountName: s.payment?.accountName || '',
      accountNumber: full ? account : '',
      accountMasked: s.payment?.accountLast4 ? maskAccount(`XXXXXXXX${s.payment.accountLast4}`) : '',
      ifsc: s.payment?.ifsc || '',
      swift: s.payment?.swift || '',
      bankName: s.payment?.bankName || '',
    },
    active: s.active !== false,
    bankChangedAt: s.bankChangedAt || null,
    bankChangedBy: s.bankChangedByName || '',
    updatedAt: s.updatedAt,
    can: { edit: full },
  };
}

const duplicate = (err) => err?.code === 11000;
const DUPLICATE = 'A supplier with this name is already saved — pick it from the list, or add something to tell them apart (e.g. the city).';

export async function create(actor, input, req) {
  if (!mayEditSuppliers(actor)) throw fail('Only procurement (or an admin) adds suppliers.', 403);
  const clean = cleanSupplier(input);
  try {
    const doc = await supplierRepository.create({ ...clean, active: true, createdByName: actor.name || '', updatedByName: actor.name || '' });
    auditLogger.logAction(req, 'CREATE', 'Supplier', doc._id, { name: doc.name });
    return shape(await supplierRepository.findById(doc._id, { account: true }), actor);
  } catch (err) {
    if (duplicate(err)) throw fail(DUPLICATE, 409);
    throw err;
  }
}

export async function update(actor, id, input, req) {
  if (!mayEditSuppliers(actor)) throw fail('Only procurement (or an admin) edits suppliers.', 403);
  const before = await load(id, { account: true });
  const clean = cleanSupplier(input);
  const set = { ...clean, updatedByName: actor.name || '' };
  if (typeof input.active === 'boolean') set.active = input.active;
  // Adding the first details to a 'none' supplier is not a change of destination (as on create).
  const changedBank = before.payment?.method !== 'none'
    && destination({ ...before.payment, accountNumber: plainAccount(before) }) !== destination(clean.payment);
  if (changedBank) Object.assign(set, { bankChangedAt: new Date(), bankChangedByName: actor.name || '' });
  try {
    const doc = await supplierRepository.update(id, set);
    auditLogger.logAction(req, 'UPDATE', 'Supplier', id, { bankChanged: changedBank, active: set.active });
    return shape(doc, actor);
  } catch (err) {
    if (duplicate(err)) throw fail(DUPLICATE, 409);
    throw err;
  }
}

/** Hide from (or bring back to) the picker. Never a delete: payments point here. */
export async function setActive(actor, id, active, req) {
  if (!mayEditSuppliers(actor)) throw fail('Only procurement (or an admin) edits suppliers.', 403);
  await load(id);
  const doc = await supplierRepository.update(id, { active: Boolean(active), updatedByName: actor.name || '' });
  auditLogger.logAction(req, 'UPDATE', 'Supplier', id, { active: Boolean(active) });
  return shape(doc, actor);
}

async function load(id, opts) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw fail('Supplier not found.', 404);
  const s = await supplierRepository.findById(id, opts);
  if (!s) throw fail('Supplier not found.', 404);
  return s;
}

export async function get(actor, id) {
  if (!maySeeSuppliers(actor)) throw fail('Not authorized.', 403);
  const s = await load(id, { account: mayEditSuppliers(actor) });
  const { balancesForSuppliers } = await import('./supplierLedgerService.js');
  return { ...shape(s, actor), credit: (await balancesForSuppliers([s._id])).get(String(s._id)) || [] };
}

export const SUPPLIER_SORTS = Object.freeze({
  // nameKey is unique (index supplier_name), so the name order needs no _id
  // tie-breaker and rides supplier_active_name (measured: 51 rows read, not every
  // active supplier sorted in memory).
  name: { field: 'nameKey', dir: 1, type: 'string', unique: true },
  newest: { field: 'createdAt', dir: -1, type: 'date' },
  updated: { field: 'updatedAt', dir: -1, type: 'date' },
});
// What a typed word is looked for in. The account number itself is encrypted, so
// only its last four digits can be found.
const SUPPLIER_SEARCH = Object.freeze([
  'nameKey', 'contactPerson', 'phone', 'email', 'gstin', 'address', 'notes',
  'payment.upiId', 'payment.accountName', 'payment.accountLast4', 'payment.ifsc', 'payment.swift', 'payment.bankName',
]);
const SUMMARY_CAP = 1000;

/**
 * The Mongo query for the list's filters (exported for tests). Unknown values are ignored.
 * `prefix` (the payment form's picker, on every keystroke): the name starts with it —
 * a range on supplier_active_name, so it reads only the matching rows.
 */
export function supplierQuery(f = {}, now = Date.now()) {
  const active = f.status === 'all' ? null : f.status !== 'inactive';
  const prefix = nameKeyOf(f.prefix).slice(0, 120);
  return and(
    active == null ? null : { active },
    prefix ? { nameKey: { $gte: prefix, $lt: `${prefix}\uffff` } } : null,
    ['bank', 'upi', 'none'].includes(f.method) ? { 'payment.method': f.method } : null,
    f.changed === 'recent' ? { bankChangedAt: { $gte: new Date(now - BANK_CHANGE_WARN_DAYS * 86400000) } } : null,
    searchClauses(searchWords(f.q), SUPPLIER_SEARCH),
  );
}

/**
 * The directory and the payment form's picker. `prefix` (picker): the name starts
 * with it. `q` (directory): every word must be in the
 * name, contact, phone, email, GSTIN, address, notes, UPI ID, account name,
 * last four account digits, IFSC, SWIFT or bank. `status` active (default) | inactive |
 * all; `method` bank | upi; `changed=recent` (bank details changed in the last
 * BANK_CHANGE_WARN_DAYS); `sort` name (default) | newest | updated; `after` the
 * cursor from the last page. The first page says how many match.
 */
export async function list(actor, params = {}) {
  if (!maySeeSuppliers(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const sortName = SUPPLIER_SORTS[f.sort] ? f.sort : 'name';
  const { items, nextCursor, ...page } = await keysetPage({
    query: supplierQuery(f), sorts: SUPPLIER_SORTS, sortName, cursor: f.after, pageSize: PAGE_SIZE,
    find: supplierRepository.page, count: (q) => supplierRepository.summary(q, SUMMARY_CAP),
  });
  // What each supplier owes us (supplier credit): one aggregate for the page.
  const { balancesForSuppliers } = await import('./supplierLedgerService.js');
  const owed = await balancesForSuppliers(items.map((s) => s._id));
  return { ...page, suppliers: items.map((s) => ({ ...shape(s, actor), credit: owed.get(String(s._id)) || [] })), nextAfter: nextCursor };
}

/**
 * For a supplier payment: the payee to COPY onto the request (decrypted), and a
 * bank-change notice when the details changed recently. Inactive suppliers refuse.
 */
export async function payeeFor(id, now = Date.now()) {
  const s = await load(id, { account: true });
  if (s.active === false) throw fail('This supplier is marked inactive — reactivate it in Suppliers first.', 409);
  const p = s.payment || {};
  if (p.method !== 'bank' && p.method !== 'upi') {
    throw fail(`Add how we pay ${s.name} (bank or UPI) in Suppliers first.`, 409);
  }
  const payee = p.method === 'upi'
    ? { name: s.name, method: 'upi', upiId: p.upiId, phone: s.phone || '' }
    : {
      name: s.name, method: 'bank', accountName: p.accountName, accountNumber: plainAccount(s),
      ifsc: p.ifsc, swift: p.swift, bankName: p.bankName, phone: s.phone || '',
    };
  const recent = s.bankChangedAt && now - new Date(s.bankChangedAt).getTime() < BANK_CHANGE_WARN_DAYS * 86400000;
  return {
    supplier: s,
    payee: cleanPayee(payee),
    bankNotice: recent ? { at: s.bankChangedAt, byName: s.bankChangedByName || '' } : null,
  };
}

export default { create, update, setActive, get, list, payeeFor, shape };
