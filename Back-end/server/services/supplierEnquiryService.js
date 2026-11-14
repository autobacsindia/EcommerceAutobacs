/**
 * Supplier price / availability enquiries — procurement's record of "is this in
 * stock, at what price?" sent to suppliers on WhatsApp.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 *   It sends nothing: the panel builds the message and a person sends it through
 *   a wa.me link (free; no WhatsApp Business API). It never touches catalogue
 *   prices, orders or supplier payments — it is a record of questions and quotes.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────
 *   procurement (active) and the admin — everything; nobody else — nothing.
 *
 * ── HOW IT STAYS RIGHT ───────────────────────────────────────────────────────
 *   • Money is whole paise; rupees typed in the panel are rounded once, here.
 *   • A double-click / retried create saves ONE enquiry (formKey, unique index).
 *   • Edits are compare-and-set on `updatedAt`: two people saving at once → the
 *     second is told to reload, never a silent overwrite.
 *   • "Sent" is stamped once (the first WhatsApp open), however many times it is clicked.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import repo from '../repositories/supplierEnquiryRepository.js';
import supplierRepository from '../repositories/supplierRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { and, escapeRegex, istDayStart, isObjectId, keysetPage, plainQuery, searchWords } from '../utils/listQuery.js';
import { findSalesProducts } from './salesOrderService.js';
import crypto from 'node:crypto';
import productRepository from '../repositories/productRepository.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const MAX_ITEMS = 30;
export const MAX_SUPPLIERS = 25;
export const GST_RATES = Object.freeze([0, 5, 12, 18, 28]);
export const UNITS = Object.freeze(['pcs', 'sets', 'pairs', 'boxes', 'litres', 'kg', 'metres']);
const MAX_PAISE = 100_000_000_00; // ₹10 crore per unit — beyond any real part
const PAGE_SIZE = 30;
export const MAX_PHOTOS_PER_ITEM = 3;
export const PHOTO_FOLDER = 'supplier-enquiries'; // a PRIVATE prefix (storage/assetScope.js)
const SUMMARY_CAP = 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const isAdmin = (u) => u?.role === 'admin';
export const mayUseEnquiries = (u) => isAdmin(u)
  || (u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.PROCUREMENT);
function guard(actor) {
  if (!mayUseEnquiries(actor)) throw fail('Supplier enquiries are for the procurement team.', 403);
}

/** Plain text, single line unless `multiline`, control characters removed. */
function text(v, max, { multiline = false } = {}) {
  // Control characters out (tab and newline kept): they break the WhatsApp text.
  let s = [...String(v ?? '')].filter((c) => { const n = c.charCodeAt(0); return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 127); }).join('');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/** Rupees as typed ("1,250.50", 1250.5) → whole paise; '' / null → null. Throws on nonsense. */
export function toPaise(v, what) {
  if (v === '' || v == null) return null;
  const s = typeof v === 'number' ? String(v) : String(v).replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw fail(`${what}: enter an amount in rupees, e.g. 1250 or 1250.50.`, 400);
  // Integer arithmetic on the digits — never a float multiply (0.29 * 100 = 28.999…).
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (paise <= 0) throw fail(`${what}: must be more than ₹0.`, 400);
  if (paise > MAX_PAISE) throw fail(`${what}: that amount is too large.`, 400);
  return paise;
}

function wholeNumber(v, { min, max, what, optional = false }) {
  if (optional && (v === '' || v == null)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(`${what}: enter a whole number from ${min} to ${max}.`, 400);
  return n;
}

/** The items, checked. Existing item ids are kept so their quotes survive an edit. */
export function cleanItems(raw, existingIds = new Set()) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw fail('Add at least one item.', 400);
  if (list.length > MAX_ITEMS) throw fail(`At most ${MAX_ITEMS} items in one enquiry.`, 400);
  return list.map((it, i) => {
    const n = i + 1;
    const name = text(it?.name, 200);
    if (name.length < 2) throw fail(`Item ${n}: enter what you need.`, 400);
    const keep = isObjectId(String(it?.id || '')) && existingIds.has(String(it.id));
    return {
      ...(keep ? { _id: new mongoose.Types.ObjectId(String(it.id)) } : {}),
      product: isObjectId(String(it?.productId || '')) ? new mongoose.Types.ObjectId(String(it.productId)) : null,
      name,
      brand: text(it?.brand, 80),
      partNo: text(it?.partNo, 80),
      fitment: text(it?.fitment, 160),
      qty: wholeNumber(it?.qty, { min: 1, max: 100000, what: `Item ${n} quantity` }),
      unit: UNITS.includes(it?.unit) ? it.unit : 'pcs',
      targetPaise: toPaise(it?.target, `Item ${n} target price`),
      note: text(it?.note, 300),
    };
  });
}

/** 'YYYY-MM-DD' (India date) → the start of that day; '' → null. */
function cleanDate(v) {
  if (v === '' || v == null) return null;
  const d = istDayStart(String(v).slice(0, 10));
  if (!d) throw fail('Needed by: pick a valid date.', 400);
  return d;
}

function cleanDetails(input = {}) {
  return {
    neededBy: cleanDate(input.neededBy),
    deliverTo: text(input.deliverTo, 200),
    notes: text(input.notes, 1000, { multiline: true }),
    showTargetPrice: input.showTargetPrice === true,
  };
}

function supplierIdsOf(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String))];
  if (!ids.length) throw fail('Pick at least one supplier.', 400);
  if (ids.length > MAX_SUPPLIERS) throw fail(`At most ${MAX_SUPPLIERS} suppliers in one enquiry.`, 400);
  if (!ids.every(isObjectId)) throw fail('One of the suppliers was not found — refresh and pick again.', 400);
  return ids;
}

/** The picked suppliers, in the order picked; each must exist and be active. */
async function loadSuppliers(ids, keepIds = new Set()) {
  const docs = await supplierRepository.findContacts(ids);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => {
    const s = byId.get(id);
    if (!s) throw fail('One of the suppliers was not found — refresh and pick again.', 400);
    if (s.active === false && !keepIds.has(id)) throw fail(`${s.name} is marked inactive — reactivate it in Suppliers first.`, 409);
    return s;
  });
}

/**
 * Each item's catalogue image, looked up here from its product (a client never
 * sends an image URL), and — on an edit — the photos it already had.
 */
async function withImages(items, before = []) {
  const ids = [...new Set(items.map((i) => i.product && String(i.product)).filter(Boolean))];
  const docs = ids.length ? await productRepository.findImages(ids) : [];
  const imageOf = new Map(docs.map((d) => [String(d._id), d.images?.[0]?.url || '']));
  const photosOf = new Map(before.map((i) => [String(i._id), i.photos || []]));
  return items.map((i) => ({
    ...i,
    image: i.product ? imageOf.get(String(i.product)) || '' : '',
    photos: i._id ? photosOf.get(String(i._id)) || [] : [],
  }));
}

const dropStored = (photos) => Promise.all(photos.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: 'image' })
  .catch(() => null)));

const newRow = (s) => ({ supplier: s._id, name: s.name, phone: s.phone || '', sentAt: null, repliedAt: null, quotes: [], note: '' });

const searchTextOf = (ref, items, suppliers) => [ref, ...items.map((i) => `${i.name} ${i.brand} ${i.partNo}`), ...suppliers.map((s) => s.name)]
  .join(' ').toLowerCase().replace(/\s+/g, ' ').slice(0, 4000);

/** ENQ-YYMM-0007 — the month in India time, then a series that never repeats. */
export function refFor(seq, now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yymm = `${String(ist.getUTCFullYear()).slice(2)}${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  return `ENQ-${yymm}-${String(seq).padStart(4, '0')}`;
}

const cleanFormKey = (v) => {
  const k = String(v ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(k) ? k : undefined;
};

// ── Shape ────────────────────────────────────────────────────────────────────

/** A quote's unit price including GST, in paise (the figure suppliers are compared on). */
export function quoteUnitWithGst(q) {
  if (q?.unitPaise == null) return null;
  if (q.gstIncluded || !q.gstRate) return q.unitPaise;
  return q.unitPaise + Math.round((q.unitPaise * q.gstRate) / 100);
}

/**
 * For each item, the supplier row with the lowest price incl. GST among those that
 * quoted and did not say "not available". Ties go to the earlier row. itemId → rowId.
 */
export function bestQuotes(items, rows) {
  const best = {};
  for (const it of items) {
    let win = null;
    for (const r of rows) {
      const q = (r.quotes || []).find((x) => String(x.item) === String(it._id));
      const unit = quoteUnitWithGst(q);
      if (unit == null || q.available === 'no') continue;
      if (!win || unit < win.unit) win = { row: String(r._id), unit };
    }
    if (win) best[String(it._id)] = win.row;
  }
  return best;
}

function shape(e) {
  const items = e.items || [];
  const rows = e.suppliers || [];
  return {
    id: idOf(e._id),
    ref: e.ref,
    status: e.status,
    neededBy: e.neededBy || null,
    deliverTo: e.deliverTo || '',
    notes: e.notes || '',
    showTargetPrice: e.showTargetPrice === true,
    contactName: e.contactName || '',
    createdByName: e.createdByName || '',
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    closedAt: e.closedAt || null,
    closedByName: e.closedByName || '',
    closeNote: e.closeNote || '',
    chosenSupplierRow: e.chosenSupplier ? String(e.chosenSupplier) : null,
    items: items.map((i) => ({
      id: idOf(i._id),
      productId: i.product ? String(i.product) : null,
      name: i.name, brand: i.brand || '', partNo: i.partNo || '', fitment: i.fitment || '',
      qty: i.qty, unit: i.unit || 'pcs', targetPaise: i.targetPaise ?? null, note: i.note || '',
      image: i.image || '',
      photos: (i.photos || []).map((f) => ({ id: idOf(f._id), name: f.name || '', contentType: f.contentType || '' })),
    })),
    suppliers: rows.map((r) => ({
      id: idOf(r._id),
      supplierId: String(r.supplier),
      name: r.name,
      phone: r.phone || '',
      sentAt: r.sentAt || null,
      repliedAt: r.repliedAt || null,
      note: r.note || '',
      quotes: (r.quotes || []).map((q) => ({
        itemId: String(q.item), unitPaise: q.unitPaise ?? null, gstRate: q.gstRate ?? null, gstIncluded: q.gstIncluded === true,
        available: q.available || '', dispatchDays: q.dispatchDays ?? null, note: q.note || '',
      })),
    })),
    best: bestQuotes(items, rows),
  };
}

function shapeRow(e) {
  const rows = e.suppliers || [];
  return {
    id: idOf(e._id),
    ref: e.ref,
    status: e.status,
    createdAt: e.createdAt,
    createdByName: e.createdByName || '',
    neededBy: e.neededBy || null,
    items: (e.items || []).slice(0, 3).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit || 'pcs' })),
    itemCount: (e.items || []).length,
    supplierCount: rows.length,
    sentCount: rows.filter((r) => r.sentAt).length,
    repliedCount: rows.filter((r) => r.repliedAt).length,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function load(id) {
  if (!isObjectId(String(id))) throw fail('Enquiry not found.', 404);
  const e = await repo.findById(id);
  if (!e) throw fail('Enquiry not found.', 404);
  return e;
}

export async function get(actor, id) {
  guard(actor);
  return shape(await load(id));
}

const SORTS = Object.freeze({ newest: { field: 'createdAt', dir: -1, type: 'date' } });
const STATUSES = ['sent', 'replied', 'closed'];

/** The query for the list's filters (exported for tests). `status` open = sent or replied. */
export function enquiryQuery(f = {}) {
  const status = f.status === 'open' ? { status: { $in: ['sent', 'replied'] } }
    : STATUSES.includes(f.status) ? { status: f.status } : null;
  const words = searchWords(f.q);
  return and(status, ...words.map((w) => ({ searchText: { $regex: escapeRegex(w) } })));
}

/** Newest first, keyset-paged; the first page says how many match. */
export async function list(actor, params = {}) {
  guard(actor);
  const f = plainQuery(params);
  const { items, nextCursor, ...page } = await keysetPage({
    query: enquiryQuery(f), sorts: SORTS, sortName: 'newest', cursor: f.after, pageSize: PAGE_SIZE,
    find: repo.page,
    count: async (q) => {
      const n = await repo.count(q, SUMMARY_CAP + 1);
      return { count: Math.min(n, SUMMARY_CAP), capped: n > SUMMARY_CAP };
    },
  });
  return { ...page, enquiries: items.map(shapeRow), nextAfter: nextCursor };
}

/** The catalogue search for an item line (same search the sales quotation uses). */
export async function searchProducts(actor, q) {
  guard(actor);
  return (await findSalesProducts(q)).map((p) => ({ id: p.id, name: p.name, sku: p.sku, image: p.image, price: p.price }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function create(actor, input = {}, req) {
  guard(actor);
  const formKey = cleanFormKey(input.formKey);
  if (formKey) {
    const seen = await repo.findByFormKey(actor._id, formKey);
    if (seen) return { enquiry: shape(seen), created: false };
  }
  const items = await withImages(cleanItems(input.items));
  const details = cleanDetails(input);
  const picked = await loadSuppliers(supplierIdsOf(input.supplierIds));
  const ref = refFor(await repo.nextNumber());
  const suppliers = picked.map(newRow);
  try {
    const doc = await repo.create({
      ref, status: 'sent', items, suppliers, ...details,
      contactName: actor.name || '',
      searchText: searchTextOf(ref, items, suppliers),
      createdBy: actor._id, createdByName: actor.name || '',
      ...(formKey ? { formKey } : {}),
    });
    auditLogger.logAction(req, 'CREATE', 'SupplierEnquiry', doc._id, { ref, items: items.length, suppliers: suppliers.length });
    return { enquiry: shape(doc), created: true };
  } catch (err) {
    // Two clicks raced past the check above: the unique index kept one.
    if (err?.code === 11000 && formKey) {
      const seen = await repo.findByFormKey(actor._id, formKey);
      if (seen) return { enquiry: shape(seen), created: false };
    }
    throw err;
  }
}

const STALE = 'Someone else changed this enquiry just now — reload it to see their changes.';
const CLOSED = 'This enquiry is closed — reopen it first.';

/**
 * Change the items, details or suppliers of an open enquiry. Kept supplier rows
 * keep their sent / reply history; quotes for a removed item are dropped.
 * `updatedAt` must be the one the editor loaded (compare-and-set).
 */
export async function update(actor, id, input = {}, req) {
  guard(actor);
  const before = await load(id);
  if (before.status === 'closed') throw fail(CLOSED, 409);
  const items = await withImages(cleanItems(input.items, new Set((before.items || []).map((i) => String(i._id)))), before.items || []);
  const keptItemIds = new Set(items.filter((i) => i._id).map((i) => String(i._id)));
  const details = cleanDetails(input);
  const existingRows = new Map((before.suppliers || []).map((r) => [String(r.supplier), r]));
  const ids = supplierIdsOf(input.supplierIds);
  const picked = await loadSuppliers(ids, new Set(existingRows.keys()));
  const suppliers = picked.map((s) => {
    const old = existingRows.get(String(s._id));
    if (!old) return newRow(s);
    return { ...old, quotes: (old.quotes || []).filter((q) => keptItemIds.has(String(q.item))) };
  });
  const status = suppliers.some((r) => r.repliedAt) ? 'replied' : 'sent';
  const loaded = new Date(input.updatedAt || 0);
  const doc = await repo.updateWhere(
    { _id: before._id, status: { $ne: 'closed' }, updatedAt: loaded },
    { $set: { items, suppliers, status, ...details, searchText: searchTextOf(before.ref, items, suppliers) } },
  );
  if (!doc) throw fail(STALE, 409);
  // Photos of removed items: their files go too (best effort — the record is already right).
  await dropStored((before.items || []).filter((i) => !keptItemIds.has(String(i._id))).flatMap((i) => i.photos || []));
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', before._id, { items: items.length, suppliers: suppliers.length });
  return shape(doc);
}

function rowIdOf(enquiry, rowId) {
  const row = (enquiry.suppliers || []).find((r) => String(r._id) === String(rowId));
  if (!row) throw fail('That supplier is not on this enquiry.', 404);
  return row;
}

/** The message was opened in WhatsApp / shared for this supplier. Stamped once. */
export async function markSent(actor, id, rowId) {
  guard(actor);
  const e = await load(id);
  const row = rowIdOf(e, rowId);
  if (row.sentAt) return shape(e);
  const doc = await repo.updateWhere(
    { _id: e._id },
    { $set: { 'suppliers.$[r].sentAt': new Date() } },
    { arrayFilters: [{ 'r._id': row._id, 'r.sentAt': null }] },
  );
  return shape(doc || e);
}

function cleanQuotes(raw, items) {
  const itemIds = new Set(items.map((i) => String(i._id)));
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap((q) => {
    const item = String(q?.itemId || '');
    if (!itemIds.has(item) || seen.has(item)) return [];
    seen.add(item);
    const name = items.find((i) => String(i._id) === item)?.name || 'Item';
    const available = ['yes', 'partial', 'no'].includes(q?.available) ? q.available : '';
    const unitPaise = toPaise(q?.unitPrice, `${name} price`);
    const gstRate = q?.gstRate === '' || q?.gstRate == null ? null : Number(q.gstRate);
    if (gstRate != null && !GST_RATES.includes(gstRate)) throw fail(`${name}: GST must be 0, 5, 12, 18 or 28%.`, 400);
    const quote = {
      item: new mongoose.Types.ObjectId(item),
      unitPaise,
      gstRate,
      gstIncluded: q?.gstIncluded === true,
      available,
      dispatchDays: wholeNumber(q?.dispatchDays, { min: 0, max: 365, what: `${name} dispatch days`, optional: true }),
      note: text(q?.note, 300),
    };
    // A line with nothing filled in is not a quote.
    return unitPaise == null && !available && quote.dispatchDays == null && !quote.note ? [] : [quote];
  });
}

/**
 * What one supplier replied: per item price, GST, availability, dispatch time.
 * Replaces that supplier's quotes; marks the enquiry replied. Replying implies sent.
 */
export async function recordQuote(actor, id, rowId, input = {}, req) {
  guard(actor);
  const e = await load(id);
  if (e.status === 'closed') throw fail(CLOSED, 409);
  const row = rowIdOf(e, rowId);
  const quotes = cleanQuotes(input.quotes, e.items || []);
  const note = text(input.note, 500, { multiline: true });
  const now = new Date();
  const replied = quotes.length > 0 || Boolean(note);
  const doc = await repo.updateWhere(
    { _id: e._id, status: { $ne: 'closed' } },
    {
      $set: {
        'suppliers.$[r].quotes': quotes,
        'suppliers.$[r].note': note,
        'suppliers.$[r].repliedAt': replied ? (row.repliedAt || now) : null,
        'suppliers.$[r].sentAt': row.sentAt || (replied ? now : null),
      },
    },
    { arrayFilters: [{ 'r._id': row._id }] },
  );
  if (!doc) throw fail(CLOSED, 409);
  // The status follows the rows (a second write: the arrayFilters update cannot read them).
  const status = (doc.suppliers || []).some((r) => r.repliedAt) ? 'replied' : 'sent';
  const final = status === doc.status ? doc : (await repo.updateWhere({ _id: e._id, status: { $ne: 'closed' } }, { $set: { status } })) || doc;
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', e._id, { quoteFrom: row.name, lines: quotes.length });
  return shape(final);
}

/** Done with it — optionally which supplier we went with. */
export async function close(actor, id, input = {}, req) {
  guard(actor);
  const e = await load(id);
  if (e.status === 'closed') return shape(e);
  const chosen = input.chosenRowId ? rowIdOf(e, input.chosenRowId)._id : null;
  const doc = await repo.updateWhere(
    { _id: e._id, status: { $ne: 'closed' } },
    { $set: { status: 'closed', closedAt: new Date(), closedByName: actor.name || '', closeNote: text(input.note, 500, { multiline: true }), chosenSupplier: chosen } },
  );
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', e._id, { closed: true });
  return shape(doc || await load(id));
}

export async function reopen(actor, id, req) {
  guard(actor);
  const e = await load(id);
  if (e.status !== 'closed') return shape(e);
  const status = (e.suppliers || []).some((r) => r.repliedAt) ? 'replied' : 'sent';
  const doc = await repo.updateWhere(
    { _id: e._id, status: 'closed' },
    { $set: { status, closedAt: null, closedByName: '', closeNote: '', chosenSupplier: null } },
  );
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', e._id, { reopened: true });
  return shape(doc || await load(id));
}

// ── Photos ───────────────────────────────────────────────────────────────────

/**
 * Add photos to one item (up to MAX_PHOTOS_PER_ITEM). Stored privately; a supplier
 * gets them through the phone's share sheet or a download, never a public link.
 * The limit holds under two uploads at once: the write only matches while the
 * item still has room, and the loser's files are removed.
 */
export async function addPhotos(actor, id, itemId, files, req) {
  guard(actor);
  const e = await load(id);
  if (e.status === 'closed') throw fail(CLOSED, 409);
  const item = (e.items || []).find((i) => String(i._id) === String(itemId));
  if (!item) throw fail('That item is not on this enquiry.', 404);
  const have = (item.photos || []).length;
  const room = MAX_PHOTOS_PER_ITEM - have;
  const list = (Array.isArray(files) ? files : []).filter((f) => f?.buffer?.length);
  if (!list.length) throw fail('Choose a photo to add.', 400);
  if (list.length > room) {
    throw fail(room > 0 ? `An item can have ${MAX_PHOTOS_PER_ITEM} photos — you can add ${room} more.` : `This item already has ${MAX_PHOTOS_PER_ITEM} photos.`, 400);
  }
  const checked = checkAttachments(list, { allowPdf: false, max: MAX_PHOTOS_PER_ITEM, noun: 'photo' });
  const stored = await storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer,
      folder: `${PHOTO_FOLDER}/${idOf(e._id)}`,
      basename: `photo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType,
      cloudinaryPrivate: true,
    });
    return { publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes, name, uploadedAt: new Date() };
  }, (f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: 'image' }));
  // "Room for n more": the (MAX - n)th photo must not exist yet.
  const doc = await repo.updateWhere(
    { _id: e._id, status: { $ne: 'closed' }, items: { $elemMatch: { _id: item._id, [`photos.${MAX_PHOTOS_PER_ITEM - stored.length}`]: { $exists: false } } } },
    { $push: { 'items.$[i].photos': { $each: stored } } },
    { arrayFilters: [{ 'i._id': item._id }] },
  );
  if (!doc) {
    await dropStored(stored);
    throw fail(`This item already has ${MAX_PHOTOS_PER_ITEM} photos — reload to see them.`, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', e._id, { photosAdded: stored.length });
  return shape(doc);
}

function photoIn(e, photoId) {
  for (const item of e.items || []) {
    const photo = (item.photos || []).find((f) => String(f._id) === String(photoId));
    if (photo) return { item, photo };
  }
  throw fail('Photo not found.', 404);
}

export async function removePhoto(actor, id, photoId, req) {
  guard(actor);
  const e = await load(id);
  if (e.status === 'closed') throw fail(CLOSED, 409);
  const { item, photo } = photoIn(e, photoId);
  const doc = await repo.updateWhere(
    { _id: e._id, status: { $ne: 'closed' } },
    { $pull: { 'items.$[i].photos': { _id: photo._id } } },
    { arrayFilters: [{ 'i._id': item._id }] },
  );
  if (!doc) throw fail(CLOSED, 409);
  await dropStored([photo]);
  auditLogger.logAction(req, 'UPDATE', 'SupplierEnquiry', e._id, { photoRemoved: true });
  return shape(doc);
}

/** One photo's bytes, for someone allowed to see the enquiry (streamed, never a public link). */
export async function getPhoto(actor, id, photoId) {
  guard(actor);
  const { photo } = photoIn(await load(id), photoId);
  const buffer = await readPrivateAsset(photo, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Photo fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: photo.contentType || 'image/jpeg', name: photo.name || 'photo' };
}

export default { list, get, create, update, markSent, recordQuote, close, reopen, searchProducts, addPhotos, removePhoto, getPhoto };
