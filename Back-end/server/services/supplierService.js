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

const fail = (message, status) => new AppError(message, status, { expose: true });
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
  const payee = cleanPayee({ ...(input.payment || {}), name });
  const payment = payee.method === 'upi'
    ? { method: 'upi', upiId: payee.upiId, accountName: '', accountNumber: '', accountLast4: '', ifsc: '', bankName: '' }
    : {
      method: 'bank', upiId: '', accountName: payee.accountName, accountNumber: payee.accountNumber,
      accountLast4: payee.accountNumber.slice(-4), ifsc: payee.ifsc, bankName: payee.bankName,
    };
  return {
    name,
    nameKey: nameKeyOf(name),
    contactPerson: text(input.contactPerson, 120),
    phone: text(input.phone, 20),
    email,
    gstin,
    address: text(input.address, 500),
    notes: text(input.notes, 1000),
    payment,
  };
}

/** Where the money goes — the fields whose change is worth a warning. */
const destination = (p = {}) => [p.method, p.upiId, p.accountNumber, p.ifsc].map((v) => String(v || '')).join('|');

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
  const changedBank = destination({ ...before.payment, accountNumber: plainAccount(before) }) !== destination(clean.payment);
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
  return shape(await load(id, { account: mayEditSuppliers(actor) }), actor);
}

/**
 * A page of suppliers by name. `q` is a name prefix (the picker types into it);
 * `status` = active (default) | inactive | all.
 */
export async function list(actor, { q = '', status = 'active', after = '' } = {}) {
  if (!maySeeSuppliers(actor)) throw fail('Not authorized.', 403);
  const active = status === 'all' ? null : status !== 'inactive';
  const rows = await supplierRepository.page({
    prefix: nameKeyOf(q).slice(0, 120), active, after: nameKeyOf(after).slice(0, 120), limit: PAGE_SIZE + 1,
  });
  const items = rows.slice(0, PAGE_SIZE);
  return {
    suppliers: items.map((s) => shape(s, actor)),
    nextAfter: rows.length > PAGE_SIZE ? items[items.length - 1].nameKey : null,
  };
}

/**
 * For a supplier payment: the payee to COPY onto the request (decrypted), and a
 * bank-change notice when the details changed recently. Inactive suppliers refuse.
 */
export async function payeeFor(id, now = Date.now()) {
  const s = await load(id, { account: true });
  if (s.active === false) throw fail('This supplier is marked inactive — reactivate it in Suppliers first.', 409);
  const p = s.payment || {};
  const payee = p.method === 'upi'
    ? { name: s.name, method: 'upi', upiId: p.upiId, phone: s.phone || '' }
    : {
      name: s.name, method: 'bank', accountName: p.accountName, accountNumber: plainAccount(s),
      ifsc: p.ifsc, bankName: p.bankName, phone: s.phone || '',
    };
  const recent = s.bankChangedAt && now - new Date(s.bankChangedAt).getTime() < BANK_CHANGE_WARN_DAYS * 86400000;
  return {
    supplier: s,
    payee: cleanPayee(payee),
    bankNotice: recent ? { at: s.bankChangedAt, byName: s.bankChangedByName || '' } : null,
  };
}

export default { create, update, setActive, get, list, payeeFor, shape };
