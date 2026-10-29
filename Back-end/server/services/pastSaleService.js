/**
 * Past (offline) sales — sales made in the store, by phone or on WhatsApp before
 * (or outside) the website, entered so they count in each salesman's totals and
 * show in a customer's history. See models/PastSale.js for why this is not Order.
 *
 * ── Who may do what ─────────────────────────────────────────────────────────
 *   GTM head / lead   enter their OWN sales ("Sold by" is always them), edit
 *                     their own. A lead sees their own; the head sees everyone's.
 *   accounts, admin   see, enter (for any salesman, or none), edit, delete and
 *                     restore any sale, and undo a whole upload.
 * No approval step: a sale counts as soon as it is saved. Every change is kept in
 * the sale's history (who, when, old → new) and in the audit log.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - nothing here sends an email / SMS / push, creates an account, touches an
 *     Order, Razorpay or a work queue. This file imports none of them.
 *   - one bill, one sale: a bill number is unique over active sales, and a sale
 *     without one is unique by its fingerprint. Both are enforced by unique
 *     indexes, so two uploads or two clicks racing still land once. Re-uploading
 *     the same sheet adds nothing.
 *   - delete is soft (restorable); a deleted sale counts nowhere.
 *   - an edit applies only to the version the person saw (compare-and-set), so
 *     two people editing at once cannot silently overwrite each other.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import pastSaleRepository from '../repositories/pastSaleRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { normalizePhone, escapeRegex } from '../utils/identity.js';
import { cleanSale, fingerprintOf, parseSheet, groupRows, parseSaleDate, invoiceKeyOf } from './pastSaleInput.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;
const CUSTOMER_HISTORY_LIMIT = 20;

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;

/** Accounts and the admin: edit, delete and restore anyone's sales. */
export const mayManage = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
/** Who may open the Past sales page at all. */
export const mayUse = (u) => mayManage(u) || canSell(u);
const seesAll = (u) => mayManage(u) || isSalesHead(u);
const isOwn = (u, s) => idOf(s.salesUser) === idOf(u?._id) || idOf(s.createdBy) === idOf(u?._id);
const mayEdit = (u, s) => s.active && (mayManage(u) || (canSell(u) && isOwn(u, s)));

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dateOf = (ymdStr) => new Date(`${ymdStr}T00:00:00.000Z`);
const isDuplicateKey = (err) => err?.code === 11000;

// ── Shape ───────────────────────────────────────────────────────────────────

export function shape(s, viewer, { withHistory = false } = {}) {
  return {
    id: idOf(s._id),
    saleDate: ymd(s.saleDate),
    invoiceNo: s.invoiceNo || '',
    customer: {
      name: s.customer?.name || '',
      phone: s.customer?.phone || '',
      email: s.customer?.email || '',
      city: s.customer?.city || '',
      state: s.customer?.state || '',
    },
    business: s.business ? { legalName: s.business.legalName || '', gstin: s.business.gstin || '' } : null,
    vehicle: s.vehicle || '',
    channel: s.channel || null,
    items: (s.items || []).map((i) => ({ product: idOf(i.product), name: i.name, quantity: i.quantity, price: i.price })),
    itemsTotal: s.itemsTotal,
    discount: s.discount || 0,
    gstAmount: s.gstAmount ?? null,
    totalAmount: s.totalAmount,
    amountMismatch: !!s.amountMismatch,
    paymentMethod: s.paymentMethod,
    notes: s.notes || '',
    soldBy: s.salesUser ? { id: idOf(s.salesUser), name: s.salesUserName || '' } : null,
    enteredBy: s.createdByName || '',
    enteredAt: s.createdAt,
    batchId: s.batchId || null,
    deleted: s.active ? null : { at: s.deletedAt || null, by: s.deletedByName || '' },
    version: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
    can: {
      edit: mayEdit(viewer, s),
      delete: s.active && mayManage(viewer),
      restore: !s.active && mayManage(viewer),
    },
    ...(withHistory ? {
      history: (s.history || []).map((h) => ({ at: h.at, by: h.byName || '', action: h.action, changes: h.changes || [] })),
    } : {}),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Anyone ever on GTM — a former salesman can still be credited with an old sale. */
async function resolveSeller(salesUserId) {
  if (!salesUserId || salesUserId === 'none') return null;
  if (!mongoose.isValidObjectId(salesUserId)) throw fail('Choose a salesman from the list.', 400);
  const u = await userRepository.model.findById(salesUserId).select('name staff').lean();
  if (!u || u.staff?.team !== STAFF_TEAMS.SALES) throw fail('Choose a salesman from the list.', 400);
  return { _id: u._id, name: u.name || '' };
}

/** Who the sale is credited to: a salesman is always themselves; accounts / admin pick. */
async function sellerFor(actor, salesUserId) {
  if (mayManage(actor)) return resolveSeller(salesUserId);
  return { _id: actor._id, name: actor.name || '' };
}

async function assertProductsExist(items) {
  const ids = [...new Set(items.map((i) => i.product).filter(Boolean))];
  if (!ids.length) return;
  if (await pastSaleRepository.countProducts(ids) !== ids.length) throw fail('A linked product no longer exists — pick it again or type the name only.', 400);
}

const badInput = (errors) => fail(errors.join(' '), 400);

function clashMessage(clash, value) {
  if (value.invoiceKey && clash.invoiceKey === value.invoiceKey) {
    return `Bill ${clash.invoiceNo || value.invoiceNo} is already entered (sale of ${ymd(clash.saleDate)} for ${clash.customer?.name || 'a customer'}${clash.salesUserName ? `, by ${clash.salesUserName}` : ''}).`;
  }
  return `This sale is already entered (${ymd(clash.saleDate)}, ${clash.customer?.name || 'a customer'}). If it really is a second sale, save it anyway.`;
}

const actorStamp = (actor) => ({ at: new Date(), by: actor._id, byName: actor.name || '' });

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * @param {Object} input  the sale (see pastSaleInput.cleanSale) + salesUserId? (accounts/admin)
 *   + allowDuplicate? (save a genuine repeat of an identical sale)
 */
export async function createPastSale(actor, input = {}, req) {
  if (!mayUse(actor)) throw fail('Not authorized.', 403);
  const { value, errors, warnings } = cleanSale(input);
  if (!value) throw badInput(errors);
  await assertProductsExist(value.items);
  const seller = await sellerFor(actor, input.salesUserId);

  let fingerprint = fingerprintOf(value, seller?._id);
  if (input.allowDuplicate === true || input.allowDuplicate === 'true') {
    // A genuine second identical sale. Only the fingerprint is relaxed — a bill
    // number still has to be unique.
    fingerprint = `${fingerprint}#${crypto.randomBytes(4).toString('hex')}`;
  }
  const [clash] = await pastSaleRepository.findActiveClashes({
    invoiceKeys: value.invoiceKey ? [value.invoiceKey] : [],
    fingerprints: [fingerprint],
  });
  if (clash) throw fail(clashMessage(clash, value), 409);

  const stamp = actorStamp(actor);
  let sale;
  try {
    sale = await pastSaleRepository.create({
      ...value,
      saleDate: dateOf(value.saleDate),
      fingerprint,
      salesUser: seller?._id || null,
      salesUserName: seller?.name || undefined,
      createdBy: actor._id,
      createdByName: actor.name || '',
      history: [{ ...stamp, action: 'created' }],
    });
  } catch (err) {
    // Two clicks / two people at the same moment: the unique index decided.
    if (isDuplicateKey(err)) throw fail('This sale was just entered — refresh the list.', 409);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'PastSale', idOf(sale._id), { totalAmount: sale.totalAmount, invoiceNo: sale.invoiceNo || null });
  return { sale: shape(sale, actor), warnings };
}

// ── Edit ────────────────────────────────────────────────────────────────────

const DIFF_FIELDS = [
  ['saleDate', 'Sale date', (s) => ymd(s.saleDate)],
  ['invoiceNo', 'Bill no', (s) => s.invoiceNo || ''],
  ['customer.name', 'Customer name', (s) => s.customer?.name || ''],
  ['customer.phone', 'Customer phone', (s) => s.customer?.phone || ''],
  ['customer.email', 'Customer email', (s) => s.customer?.email || ''],
  ['customer.city', 'City', (s) => s.customer?.city || ''],
  ['customer.state', 'State', (s) => s.customer?.state || ''],
  ['business', 'Company / GSTIN', (s) => (s.business ? [s.business.legalName, s.business.gstin].filter(Boolean).join(' · ') : '')],
  ['vehicle', 'Car', (s) => s.vehicle || ''],
  ['channel', 'Where sold', (s) => s.channel || ''],
  ['items', 'Items', (s) => (s.items || []).map((i) => `${i.name} × ${i.quantity} @ ${i.price}`).join('; ')],
  ['discount', 'Discount', (s) => String(s.discount || 0)],
  ['gstAmount', 'GST amount', (s) => (s.gstAmount == null ? '' : String(s.gstAmount))],
  ['totalAmount', 'Total paid', (s) => String(s.totalAmount)],
  ['paymentMethod', 'Payment method', (s) => s.paymentMethod || ''],
  ['notes', 'Notes', (s) => s.notes || ''],
  ['salesUser', 'Sold by', (s) => s.salesUserName || (s.salesUser ? 'Former member' : 'No salesman')],
];

/** Field-by-field old → new, for the history. Pure; exported for tests. */
export function diffSales(before, after) {
  return DIFF_FIELDS
    .map(([, label, read]) => ({ field: label, from: read(before), to: read(after) }))
    .filter((c) => c.from !== c.to)
    .map((c) => ({ field: c.field, from: c.from.slice(0, 500), to: c.to.slice(0, 500) }));
}

/** @param {Object} input the whole sale as the form holds it, plus `version` it was loaded at. */
export async function updatePastSale(actor, id, input = {}, req) {
  const s = await loadVisible(actor, id);
  if (!s.active) throw fail('This sale is deleted — restore it first.', 409);
  if (!mayEdit(actor, s)) throw fail('You can only edit sales you entered.', 403);
  if (!input.version || new Date(input.version).toISOString() !== new Date(s.updatedAt).toISOString()) {
    throw fail('Someone changed this sale after you opened it. Reload it and make your change again.', 409);
  }
  const { value, errors, warnings } = cleanSale(input);
  if (!value) throw badInput(errors);
  await assertProductsExist(value.items);

  const seller = mayManage(actor) && input.salesUserId !== undefined
    ? await resolveSeller(input.salesUserId)
    : (s.salesUser ? { _id: s.salesUser, name: s.salesUserName || '' } : null);

  const next = { ...value, saleDate: dateOf(value.saleDate), salesUser: seller?._id || null, salesUserName: seller?.name || undefined };
  const changes = diffSales(s, next);
  if (!changes.length) return { sale: shape(s, actor), warnings, changed: false };

  // Keep a "save anyway" suffix while the sale itself is unchanged in substance.
  const base = fingerprintOf(value, seller?._id);
  const fingerprint = s.fingerprint.split('#')[0] === base ? s.fingerprint : base;

  const set = { ...next, fingerprint };
  const unset = {};
  for (const k of ['invoiceNo', 'invoiceKey', 'business', 'vehicle', 'channel', 'gstAmount', 'notes', 'salesUserName']) {
    if (set[k] === undefined) { delete set[k]; unset[k] = ''; }
  }
  for (const k of ['phone', 'phoneKey', 'email', 'city', 'state']) {
    if (set.customer[k] === undefined) delete set.customer[k];
  }

  let updated;
  try {
    updated = await pastSaleRepository.updateIf(
      s._id, s.updatedAt, { active: true },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { ...actorStamp(actor), action: 'edited', changes },
    );
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw fail(value.invoiceKey ? `Bill ${value.invoiceNo} is already entered on another sale.` : 'Another sale already has exactly these details.', 409);
    }
    throw err;
  }
  if (!updated) throw fail('Someone changed this sale after you opened it. Reload it and make your change again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'PastSale', idOf(s._id), { changes: changes.map((c) => c.field) });
  return { sale: shape(updated, actor, { withHistory: true }), warnings, changed: true };
}

// ── Delete / restore (accounts, admin) ──────────────────────────────────────

export async function deletePastSale(actor, id, req) {
  if (!mayManage(actor)) throw fail('Only accounts and the admin can delete a sale.', 403);
  const s = await loadVisible(actor, id);
  if (!s.active) return { sale: shape(s, actor) }; // a second click: already deleted
  const stamp = actorStamp(actor);
  const updated = await pastSaleRepository.updateIf(
    s._id, s.updatedAt, { active: true },
    { $set: { active: false, deletedAt: stamp.at, deletedBy: stamp.by, deletedByName: stamp.byName } },
    { ...stamp, action: 'deleted' },
  );
  if (!updated) throw fail('Someone changed this sale just now. Reload and try again.', 409);
  auditLogger.logAction(req, 'DELETE', 'PastSale', idOf(s._id), { totalAmount: s.totalAmount, invoiceNo: s.invoiceNo || null });
  return { sale: shape(updated, actor) };
}

export async function restorePastSale(actor, id, req) {
  if (!mayManage(actor)) throw fail('Only accounts and the admin can restore a sale.', 403);
  const s = await loadVisible(actor, id);
  if (s.active) return { sale: shape(s, actor) };
  let updated;
  try {
    updated = await pastSaleRepository.updateIf(
      s._id, s.updatedAt, { active: false },
      { $set: { active: true }, $unset: { deletedAt: '', deletedBy: '', deletedByName: '' } },
      { ...actorStamp(actor), action: 'restored' },
    );
  } catch (err) {
    if (isDuplicateKey(err)) throw fail('This sale was entered again after it was deleted. Delete the newer one first, then restore this.', 409);
    throw err;
  }
  if (!updated) throw fail('Someone changed this sale just now. Reload and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'PastSale', idOf(s._id), { change: 'restored' });
  return { sale: shape(updated, actor) };
}

/** Undo one spreadsheet upload: soft-delete every sale it added that is still active. */
export async function deleteUpload(actor, batchId, req) {
  if (!mayManage(actor)) throw fail('Only accounts and the admin can undo an upload.', 403);
  if (!/^[a-f0-9]{16,40}$/.test(String(batchId || ''))) throw fail('Upload not found.', 404);
  const res = await pastSaleRepository.deleteBatch(batchId, actorStamp(actor));
  auditLogger.logAction(req, 'DELETE', 'PastSaleUpload', batchId, { deleted: res.modifiedCount });
  return { deleted: res.modifiedCount };
}

// ── Read ────────────────────────────────────────────────────────────────────

async function loadVisible(actor, id) {
  if (!mayUse(actor)) throw fail('Not authorized.', 403);
  if (!mongoose.isValidObjectId(id)) throw fail('Sale not found.', 404);
  const s = await pastSaleRepository.findById(id);
  if (!s || (!seesAll(actor) && idOf(s.salesUser) !== idOf(actor._id))) throw fail('Sale not found.', 404);
  return s;
}

export async function getPastSale(actor, id) {
  return shape(await loadVisible(actor, id), actor, { withHistory: true });
}

const encodeCursor = (s) => Buffer.from(`${new Date(s.saleDate).toISOString()}|${s._id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, cid] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const saleDate = new Date(iso);
    if (Number.isNaN(saleDate.getTime()) || !/^[a-f0-9]{24}$/i.test(cid || '')) return null;
    return { saleDate, id: new mongoose.Types.ObjectId(cid) };
  } catch {
    return null;
  }
}

/** Shared by the list and the totals: who + when, scoped to what the viewer may see. */
function filterFor(actor, { from, to, seller } = {}) {
  if (!mayUse(actor)) throw fail('Not authorized.', 403);
  const query = {};
  if (!seesAll(actor)) query.salesUser = actor._id;
  else if (seller === 'none') query.salesUser = null;
  else if (seller) {
    if (!mongoose.isValidObjectId(seller)) throw fail('Choose a salesman from the list.', 400);
    query.salesUser = new mongoose.Types.ObjectId(String(seller));
  }
  const fromYmd = from ? parseSaleDate(from) : null;
  const toYmd = to ? parseSaleDate(to) : null;
  if ((from && !fromYmd) || (to && !toYmd)) throw fail('Choose a valid date range.', 400);
  if (fromYmd || toYmd) {
    query.saleDate = { ...(fromYmd ? { $gte: dateOf(fromYmd) } : {}), ...(toYmd ? { $lte: dateOf(toYmd) } : {}) };
  }
  return query;
}

/**
 * @param {{ cursor?, from?, to?, seller?, q?, deleted?, batch? }} params
 *   q: a phone number (any format), a bill number, or part of the customer's name.
 */
export async function listPastSales(actor, params = {}) {
  const query = filterFor(actor, params);
  const showDeleted = params.deleted === '1' || params.deleted === true;
  if (showDeleted && !mayManage(actor)) throw fail('Not authorized.', 403);
  query.active = !showDeleted;
  if (params.batch) query.batchId = String(params.batch);

  const q = String(params.q || '').trim().slice(0, 100);
  if (q) {
    const phoneKey = /\d{7,}/.test(q.replace(/\D/g, '')) && !/[a-z]/i.test(q) ? normalizePhone(q) : null;
    const or = [{ invoiceKey: invoiceKeyOf(q) }, { 'customer.name': { $regex: escapeRegex(q), $options: 'i' } }];
    if (phoneKey) or.unshift({ 'customer.phoneKey': phoneKey });
    query.$or = or;
  }

  const rows = await pastSaleRepository.page(query, { before: decodeCursor(params.cursor), limit: PAGE_SIZE + 1 });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { sales: items.map((s) => shape(s, actor)), nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

/** Number and value of sales per salesman over the chosen dates (deleted ones never count). */
export async function pastSaleTotals(actor, params = {}) {
  const match = filterFor(actor, params);
  const rows = await pastSaleRepository.totalsBySeller(match);
  const sellers = rows.map((r) => ({
    id: idOf(r._id),
    name: r._id ? (r.name || 'Former member') : 'No salesman',
    sales: r.sales,
    value: Math.round(r.value * 100) / 100,
  }));
  return {
    sellers,
    total: {
      sales: sellers.reduce((n, r) => n + r.sales, 0),
      value: Math.round(sellers.reduce((n, r) => n + r.value * 100, 0)) / 100,
    },
  };
}

/** For accounts / admin choosing "Sold by": everyone ever on GTM, current first. */
export async function listPastSaleSellers(actor) {
  if (!mayManage(actor)) throw fail('Not authorized.', 403);
  const users = await userRepository.model.find({ 'staff.team': STAFF_TEAMS.SALES })
    .select('name staff.active role').sort({ name: 1 }).lean();
  return users
    .map((u) => ({ id: idOf(u._id), name: u.name || '', current: u.role === 'staff' && u.staff?.active === true }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
}

/**
 * A customer's past purchases, by phone — for staff screens that already show
 * that customer (the lead page). The caller has already checked who may see it.
 */
export async function customerPastSales(phone) {
  const phoneKey = normalizePhone(String(phone || ''));
  if (!phoneKey) return [];
  const rows = await pastSaleRepository.findByPhoneKey(phoneKey, CUSTOMER_HISTORY_LIMIT);
  return rows.map((s) => ({
    id: idOf(s._id),
    saleDate: ymd(s.saleDate),
    invoiceNo: s.invoiceNo || '',
    items: (s.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
    totalAmount: s.totalAmount,
    paymentMethod: s.paymentMethod,
    channel: s.channel || null,
    soldBy: s.salesUserName || '',
  }));
}

// ── Spreadsheet upload ──────────────────────────────────────────────────────

/**
 * Read a sheet and decide, per sale, whether it is ready, already entered, or
 * has problems. Writes nothing. Used by both the preview and the import, so the
 * import does exactly what the preview showed.
 */
async function planUpload(actor, buffer, { salesUserId } = {}) {
  if (!mayUse(actor)) throw fail('Not authorized.', 403);
  const seller = await sellerFor(actor, salesUserId);
  const groups = groupRows(parseSheet(buffer));
  const now = Date.now();

  const planned = groups.map((g) => {
    const { value, errors, warnings } = cleanSale(g.input, { now });
    const allErrors = [...g.conflicts, ...errors];
    const fingerprint = value ? fingerprintOf(value, seller?._id) : null;
    return { g, value: allErrors.length ? null : value, errors: allErrors, warnings, fingerprint };
  });

  // Inside the file: the same bill twice (by number or by content).
  const seen = new Map();
  for (const p of planned) {
    if (!p.value) continue;
    const key = p.value.invoiceKey ? `i:${p.value.invoiceKey}` : `f:${p.fingerprint}`;
    if (seen.has(key)) { p.duplicateInFile = seen.get(key); continue; }
    seen.set(key, p.g.rows[0]);
  }

  // Already on the website.
  const ready = planned.filter((p) => p.value && !p.duplicateInFile);
  const clashes = await pastSaleRepository.findActiveClashes({
    invoiceKeys: ready.map((p) => p.value.invoiceKey).filter(Boolean),
    fingerprints: ready.map((p) => p.fingerprint),
  });
  const byInvoice = new Map(clashes.filter((c) => c.invoiceKey).map((c) => [c.invoiceKey, c]));
  const byPrint = new Map(clashes.map((c) => [c.fingerprint, c]));
  for (const p of ready) p.clash = (p.value.invoiceKey && byInvoice.get(p.value.invoiceKey)) || byPrint.get(p.fingerprint) || null;

  // Linked products are not offered in a sheet (names only), so nothing to check.
  return { seller, planned };
}

function describePlan(planned) {
  const sales = planned.map((p) => {
    let status = 'ready';
    let reasons = p.errors;
    if (!p.value) status = 'error';
    else if (p.duplicateInFile) { status = 'duplicate'; reasons = [`Same bill as row ${p.duplicateInFile} in this file.`]; }
    else if (p.clash) { status = 'duplicate'; reasons = [clashMessage(p.clash, p.value).replace(' If it really is a second sale, save it anyway.', '')]; }
    const input = p.g.input;
    return {
      rows: p.g.rows,
      status,
      reasons,
      warnings: p.value ? p.warnings : [],
      saleDate: p.value?.saleDate || String(input.saleDate || ''),
      invoiceNo: String(input.invoiceNo || ''),
      customer: String(input.customer?.name || ''),
      items: input.items.length,
      totalAmount: p.value?.totalAmount ?? null,
    };
  });
  const count = (st) => sales.filter((s) => s.status === st).length;
  return {
    sales,
    counts: {
      rows: sales.reduce((n, s) => n + s.rows.length, 0),
      sales: sales.length,
      ready: count('ready'),
      duplicates: count('duplicate'),
      errors: count('error'),
    },
    readyValue: Math.round(sales.filter((s) => s.status === 'ready').reduce((n, s) => n + s.totalAmount * 100, 0)) / 100,
  };
}

export async function previewUpload(actor, buffer, opts = {}) {
  const { planned } = await planUpload(actor, buffer, opts);
  return describePlan(planned);
}

/**
 * Import the ready sales of a sheet. Sales with problems or already entered are
 * skipped (and listed), so the salesman can fix the sheet and upload it again:
 * what went in the first time is then "already entered", never a second copy.
 */
export async function importUpload(actor, buffer, opts = {}, req) {
  const { seller, planned } = await planUpload(actor, buffer, opts);
  const batchId = crypto.randomBytes(12).toString('hex');
  const stamp = actorStamp(actor);
  const toInsert = planned.filter((p) => p.value && !p.duplicateInFile && !p.clash);
  // One round trip per 500 sales rather than one per sale (a 2,000-row sheet was
  // 2,000 sequential inserts). Unordered, so one duplicate does not stop the rest.
  const duplicates = await pastSaleRepository.insertManyIgnoringDuplicates(toInsert.map((p) => ({
    ...p.value,
    saleDate: dateOf(p.value.saleDate),
    fingerprint: p.fingerprint,
    salesUser: seller?._id || null,
    salesUserName: seller?.name || undefined,
    createdBy: actor._id,
    createdByName: actor.name || '',
    batchId,
    history: [{ ...stamp, action: 'created' }],
  })));
  // Entered by someone else between the check and now: the index decided.
  for (const i of duplicates) {
    const p = toInsert[i];
    p.clash = { saleDate: dateOf(p.value.saleDate), customer: p.value.customer, invoiceKey: p.value.invoiceKey, invoiceNo: p.value.invoiceNo };
  }
  const imported = toInsert.length - duplicates.size;
  const result = describePlan(planned);
  // describePlan marks what was just imported as "ready"; report it as imported.
  for (const s of result.sales) if (s.status === 'ready') s.status = 'imported';
  result.counts.imported = imported;
  delete result.counts.ready;
  result.importedValue = result.readyValue;
  delete result.readyValue;
  result.batchId = imported ? batchId : null;
  auditLogger.logAction(req, 'CREATE', 'PastSaleUpload', batchId, { imported, sales: result.counts.sales });
  return result;
}

export default {
  createPastSale, updatePastSale, deletePastSale, restorePastSale, deleteUpload,
  getPastSale, listPastSales, pastSaleTotals, listPastSaleSellers, customerPastSales,
  previewUpload, importUpload, mayManage, mayUse,
};
