/**
 * GTM quotations — quotation first, payment after (models/SalesQuotation.js).
 *
 *   create   → priced by the same code as a sales order (priceSalesLines); a PDF
 *              to share. No order, no Razorpay link, nothing in Orders.
 *   edit     → while open: re-priced, version + 1, the old lines kept in revisions
 *   cancel   → while open
 *   accept   → the customer agreed: the catalogue is re-checked, then ONE order is
 *              created from these exact lines with no link yet (paymentMode
 *              'later'); payment is then requested on it (salesPaymentService)
 *
 * Who: the GTM head and leads (canSell). A seller sees and acts on their own
 * quotations; the GTM head on every one. An admin may read any.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import salesQuotationRepository from '../repositories/salesQuotationRepository.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import { priceSalesLines } from './salesOrderService.js';
import { createOfflineOrderRecord } from './offlineOrderService.js';
import { buildQuotation, renderQuotationPdf } from './quotationService.js';
import { QUOTATION_VALID_DAYS } from '../config/quotation.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { phoneOnlyEmailFor } from '../utils/customerContact.js';
import { buildHold, shapeHold, heldFilter, notHeldFilter } from '../utils/salesHold.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const isAdmin = (u) => u?.role === 'admin';
const isSalesHead = (u) => u?.role === 'staff' && u.staff?.active === true
  && u.staff.team === STAFF_TEAMS.SALES && u.staff.isHead === true;

/** "QT-7F3A91C2" — from the quotation's own id, like an order number. */
const quotationNumberFor = (id) => `QT-${String(id).slice(-8).toUpperCase()}`;
/** The number as printed: version 2 onwards carries "-v2". */
export const printedNumber = (q) => (q.version > 1 ? `${q.number}-v${q.version}` : q.number);

const totalOf = (lines) => round2(lines.reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0));

function cleanCustomer(input = {}) {
  return {
    name: String(input.name ?? '').trim(),
    email: String(input.email ?? '').trim().toLowerCase(),
    phone: String(input.phone ?? '').trim(),
  };
}

function cleanAddress(input = {}, customer) {
  return {
    fullName: String(input.fullName || customer.name).trim(),
    phone: String(input.phone || customer.phone).trim(),
    addressLine1: String(input.addressLine1 ?? '').trim(),
    addressLine2: String(input.addressLine2 ?? '').trim(),
    city: String(input.city ?? '').trim(),
    state: String(input.state ?? '').trim(),
    postalCode: String(input.postalCode ?? '').trim(),
    country: String(input.country || 'India').trim(),
  };
}

/** The lines a quotation stores (no Mongo-only fields). */
const storeLines = (lines) => lines.map((l) => ({
  ...(l.product ? { product: l.product } : {}),
  variantId: l.variantId || null,
  variantLabel: l.variantLabel || null,
  ...(l.custom ? { custom: true } : {}),
  name: l.name,
  image: l.image || '',
  quantity: l.quantity,
  price: l.price,
  listPrice: l.listPrice ?? null,
}));

/** A quotation's stored lines as priceSalesLines input — to re-check at accept. */
const asPricingInput = (lines) => lines.map((l) => (l.custom
  ? { custom: true, name: l.name, quantity: l.quantity, price: l.price }
  : { product: idOf(l.product), variantId: l.variantId ? idOf(l.variantId) : null, quantity: l.quantity, offerPrice: l.price }));

export function shapeQuotation(q, { now = Date.now() } = {}) {
  const expired = q.status === 'open' && new Date(q.validUntil).getTime() < now;
  return {
    id: idOf(q),
    number: printedNumber(q),
    version: q.version,
    status: expired ? 'expired' : q.status,
    // Only an open quotation can be on hold; an accepted / cancelled one keeps the
    // old field but it no longer means anything.
    hold: q.status === 'open' ? shapeHold(q.hold, now) : null,
    customer: { ...q.customer },
    shippingAddress: q.shippingAddress,
    items: (q.items || []).map((l) => ({
      product: l.product ? idOf(l.product) : null,
      variantId: l.variantId ? idOf(l.variantId) : null,
      variantLabel: l.variantLabel || null,
      custom: !!l.custom,
      name: l.name,
      image: l.image || '',
      quantity: l.quantity,
      price: l.price,
      listPrice: l.listPrice ?? null,
    })),
    totalAmount: q.totalAmount,
    notes: q.notes || '',
    validUntil: q.validUntil,
    salesPerson: q.salesUser?.name || null,
    orderId: q.order ? idOf(q.order) : null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    revisions: (q.revisions || []).map((r) => ({ version: r.version, totalAmount: r.totalAmount, savedAt: r.savedAt })),
  };
}

function mayRead(actor, q) {
  return isAdmin(actor) || isSalesHead(actor) || (canSell(actor) && idOf(q.salesUser) === idOf(actor._id));
}
function mayAct(actor, q) {
  return canSell(actor) && (isSalesHead(actor) || idOf(q.salesUser) === idOf(actor._id));
}

async function loadReadable(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Quotation not found.', 404);
  const q = await salesQuotationRepository.model.findById(id).populate('salesUser', 'name').lean();
  if (!q || !mayRead(actor, q)) throw fail('Quotation not found.', 404);
  return q;
}

async function loadActionable(actor, id) {
  const q = await loadReadable(actor, id);
  if (!mayAct(actor, q)) throw fail('You can only change your own quotations.', 403);
  if (q.status !== 'open') throw fail(`This quotation is already ${q.status}.`, 409);
  return q;
}

/** New quotation. Lines are priced exactly as a sales order's would be. */
export async function createQuotation(actor, input, req) {
  if (!canSell(actor)) throw fail('Only the GTM head and GTM leads can create quotations.', 403);
  const lines = await priceSalesLines(input.items);
  const customer = cleanCustomer(input.customer);
  const rep = await salesRepRepository.findOrCreateForUser(actor);
  const _id = new mongoose.Types.ObjectId();
  const total = totalOf(lines);
  const created = await salesQuotationRepository.create({
    _id,
    number: quotationNumberFor(_id),
    version: 1,
    status: 'open',
    customer,
    shippingAddress: cleanAddress(input.shippingAddress, customer),
    items: storeLines(lines),
    subtotal: total,
    totalAmount: total,
    notes: input.notes ? String(input.notes).slice(0, 1000) : '',
    salesUser: actor._id,
    salesRep: rep._id,
    validUntil: new Date(Date.now() + QUOTATION_VALID_DAYS * DAY),
  });
  auditLogger.logAction(req, 'CREATE', 'SalesQuotation', created._id, {
    totalAmount: total, lines: lines.length, customLines: lines.filter((l) => l.custom).length,
  });
  return shapeQuotation({ ...(created.toObject?.() ?? created), salesUser: { _id: actor._id, name: actor.name } });
}

/** Edit an open quotation: re-priced, version + 1, validity restarts, old lines kept. */
export async function updateQuotation(actor, id, input, req) {
  const q = await loadActionable(actor, id);
  const lines = await priceSalesLines(input.items);
  const customer = cleanCustomer(input.customer);
  const total = totalOf(lines);
  const updated = await salesQuotationRepository.model.findOneAndUpdate(
    // The version guard makes two concurrent edits a clean conflict, not a lost update.
    { _id: q._id, status: 'open', version: q.version },
    {
      $set: {
        customer,
        shippingAddress: cleanAddress(input.shippingAddress, customer),
        items: storeLines(lines),
        subtotal: total,
        totalAmount: total,
        notes: input.notes ? String(input.notes).slice(0, 1000) : '',
        validUntil: new Date(Date.now() + QUOTATION_VALID_DAYS * DAY),
      },
      $inc: { version: 1 },
      $push: { revisions: { version: q.version, items: q.items, totalAmount: q.totalAmount, savedAt: new Date(), savedBy: actor._id } },
    },
    { new: true },
  ).populate('salesUser', 'name').lean();
  if (!updated) throw fail('Someone else changed this quotation just now — reload it and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, { version: updated.version, totalAmount: total });
  return shapeQuotation(updated);
}

export async function cancelQuotation(actor, id, req) {
  const q = await loadActionable(actor, id);
  const updated = await salesQuotationRepository.updateIfOpen(q._id, {
    $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor._id },
  });
  if (!updated) throw fail('This quotation was changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, { change: 'cancelled' });
  return shapeQuotation({ ...updated, salesUser: q.salesUser });
}

/**
 * "On hold — customer thinking": park an open quotation until a follow-up date
 * (`until`, YYYY-MM-DD; default in 3 days) so the seller's active list holds
 * only live conversations. Nothing about the quotation changes — it can still
 * be edited, shared, accepted or cancelled while on hold. Holding again just
 * moves the date.
 */
export async function holdQuotation(actor, id, input = {}, req) {
  const q = await loadActionable(actor, id);
  const hold = buildHold(actor, input);
  const updated = await salesQuotationRepository.updateIfOpen(q._id, { $set: { hold } });
  if (!updated) throw fail('This quotation was changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, { change: 'on_hold', until: hold.until });
  return shapeQuotation({ ...updated, salesUser: q.salesUser });
}

/** Back to the active list. Resuming one that is not on hold is a no-op. */
export async function resumeQuotation(actor, id, req) {
  const q = await loadActionable(actor, id);
  if (!q.hold) return shapeQuotation(q);
  const updated = await salesQuotationRepository.updateIfOpen(q._id, { $unset: { hold: '' } });
  if (!updated) throw fail('This quotation was changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, { change: 'resumed' });
  return shapeQuotation({ ...updated, salesUser: q.salesUser });
}

/**
 * The customer accepted: create the order from these exact lines, with no payment
 * link yet. The catalogue is re-checked first (still sold, in stock, and still at
 * or above the quoted price) — a quotation that no longer holds must be edited.
 */
export async function acceptQuotation(actor, id, req) {
  const q = await loadActionable(actor, id);
  if (new Date(q.validUntil).getTime() < Date.now()) {
    throw fail('This quotation has expired. Edit it to re-check prices and stock, share the new version, then accept it.', 409);
  }

  let lineItems;
  try {
    lineItems = await priceSalesLines(asPricingInput(q.items));
  } catch (err) {
    throw fail(`The catalogue changed since this quotation: ${err.message} Edit the quotation, then accept it.`, 409);
  }
  if (Math.round(totalOf(lineItems) * 100) !== Math.round(Number(q.totalAmount) * 100)) {
    throw fail('Prices changed since this quotation. Edit it to refresh the prices, then accept it.', 409);
  }

  // Claim first, so two "accept" clicks can never create two orders.
  const claimed = await salesQuotationRepository.updateIfOpen(q._id, {
    $set: { status: 'accepted', acceptedAt: new Date(), acceptedBy: actor._id },
  });
  if (!claimed) throw fail('This quotation was changed just now — reload it.', 409);

  let order;
  try {
    ({ order } = await createOfflineOrderRecord({
      body: {}, // retail buyer: no GSTIN block from the panel
      email: q.customer.email || phoneOnlyEmailFor(q.customer.phone),
      phone: q.customer.phone,
      name: q.customer.name,
      lineItems,
      shippingAddress: q.shippingAddress,
      paymentMode: 'later',
      salesRepId: q.salesRep,
      // Credited to the person who made the quotation, even when the head accepts it.
      salesUserId: q.salesUser._id ?? q.salesUser,
      actorId: actor._id,
      notes: q.notes || undefined,
      defaultNote: `Order from quotation ${printedNumber(q)}, accepted in the team panel by ${actor.name}`,
    }));
  } catch (err) {
    // Release the claim so the quotation can be accepted again.
    await salesQuotationRepository.update(q._id, { $set: { status: 'open', acceptedAt: null, acceptedBy: null } }).catch(() => {});
    throw err;
  }

  await salesQuotationRepository.update(q._id, { $set: { order: order._id } });
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, { change: 'accepted', order: idOf(order._id), totalAmount: order.totalAmount });
  return { quotation: shapeQuotation({ ...claimed, order: order._id, salesUser: q.salesUser }), orderId: idOf(order._id) };
}

export async function getQuotation(actor, id) {
  return shapeQuotation(await loadReadable(actor, id));
}

/** "My quotations" (seller) or every quotation (GTM head), newest first, keyset. */
export async function listQuotations(actor, { cursor, status } = {}) {
  if (!canSell(actor) && !isAdmin(actor)) throw fail('Not authorized.', 403);
  const filter = isSalesHead(actor) || isAdmin(actor) ? {} : { salesUser: actor._id };
  if (['open', 'accepted', 'cancelled'].includes(status)) filter.status = status;
  // "Open" is the active list: on-hold quotations leave it until their follow-up
  // date, then come back (marked due). "On hold" lists the parked ones.
  if (status === 'open') Object.assign(filter, notHeldFilter('hold'));
  if (status === 'on_hold') Object.assign(filter, { status: 'open' }, heldFilter('hold'));
  const before = cursor && mongoose.isValidObjectId(cursor) ? new mongoose.Types.ObjectId(cursor) : null;
  const rows = await salesQuotationRepository.model
    .find({ ...filter, ...(before ? { _id: { $lt: before } } : {}) })
    .sort({ _id: -1 })
    .limit(PAGE_SIZE + 1)
    .populate('salesUser', 'name')
    .lean();
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    quotations: items.map((q) => shapeQuotation(q)),
    nextCursor: hasMore ? idOf(items[items.length - 1]._id) : null,
    scope: isSalesHead(actor) || isAdmin(actor) ? 'team' : 'mine',
  };
}

/** The quotation PDF — same layout as before; never carries a payment link. */
export async function getQuotationDocument(actor, id) {
  const q = await loadReadable(actor, id);
  if (q.status === 'cancelled') throw fail('This quotation was cancelled.', 409);
  const asOrder = {
    _id: q._id,
    createdAt: q.revisions?.length ? q.revisions[q.revisions.length - 1].savedAt : q.createdAt,
    items: q.items,
    shippingAddress: q.shippingAddress,
    user: { name: q.customer.name, email: q.customer.email, phone: q.customer.phone },
    totalAmount: q.totalAmount,
    shippingCost: 0,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
  };
  const built = buildQuotation(asOrder);
  const doc = { ...built, number: printedNumber(q), orderRef: printedNumber(q), validUntil: q.validUntil };
  const buffer = await renderQuotationPdf(doc);
  return { buffer, filename: `Quotation-${printedNumber(q)}.pdf` };
}

/** The quotation an order came from, if any (for the order screen). */
export async function quotationForOrder(orderId) {
  const q = await salesQuotationRepository.model.findOne({ order: orderId }).select('number version').lean();
  return q ? { id: idOf(q._id), number: printedNumber(q) } : null;
}

export default { createQuotation, updateQuotation, cancelQuotation, acceptQuotation, holdQuotation, resumeQuotation, getQuotation, listQuotations, getQuotationDocument };
