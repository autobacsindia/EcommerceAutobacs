/**
 * GTM quotations — quotation first, payment after (models/SalesQuotation.js).
 *
 *   create   → priced by the same code as a sales order (priceSalesLines); a PDF
 *              to share. No order, no Razorpay link, nothing in Orders.
 *   discount → an optional percent off the whole quotation, with a reason
 *              (utils/quoteDiscount.js). The server computes the rupee amount and
 *              the total from the lines; the browser sends only percent + reason.
 *   edit     → while open: re-priced, version + 1, the old lines kept in revisions.
 *              After the customer accepted, while NOTHING is paid: every waiting
 *              link is cancelled at Razorpay, the unpaid order is cancelled quietly
 *              and the quotation re-opens as the next version, to be accepted again
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
import { cleanDiscountInput, priceWithDiscount } from '../utils/quoteDiscount.js';
import { approvalState, isBlocked, priceKeyOf, APPROVAL_THRESHOLD_PERCENT } from '../utils/discountApproval.js';
import {
  and, amountOf, isObjectId, istRange, keysetPage, plainQuery, searchClauses, searchWords,
} from '../utils/listQuery.js';
import { toPaise } from '../utils/money.js';
import orderRepository from '../repositories/orderRepository.js';
import orderStatusService from './orderStatusService.js';
import { retireAllParts } from './salesPaymentService.js';
import { retireCurrentLink } from './salesOrderService.js';
import { voidForOrder as voidSpinForOrder } from './spinService.js';

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
    alternatePhone: String(input.alternatePhone ?? '').trim(),
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

/**
 * The discount to store: percent + reason checked, amount from the server's sum.
 * Unchanged percent and reason keep who first gave it; any change is credited to
 * the person saving now.
 */
function storedDiscount(actor, wanted, amount, previous) {
  if (!wanted) return undefined;
  const same = previous && previous.percent === wanted.percent && previous.reason === wanted.reason;
  return same
    ? { percent: wanted.percent, amount, reason: wanted.reason, by: previous.by, byName: previous.byName || '', at: previous.at }
    : { percent: wanted.percent, amount, reason: wanted.reason, by: actor._id, byName: actor.name || '', at: new Date() };
}

/** Lines + discount → everything a quotation stores about money. */
async function priceQuotation(actor, input, previousDiscount = null) {
  const lines = await priceSalesLines(input.items);
  // Validated before anything else happens, so a bad percent changes nothing.
  const wanted = cleanDiscountInput(input.discount);
  const priced = priceWithDiscount(totalOf(lines), wanted);
  return {
    lines,
    subtotal: priced.subtotal,
    totalAmount: priced.total,
    discount: storedDiscount(actor, wanted, priced.amount, previousDiscount),
  };
}

const shapeDiscount = (d) => (d?.percent
  ? { percent: d.percent, amount: d.amount, reason: d.reason || '', byName: d.byName || null, at: d.at || null }
  : null);

/**
 * Where the quotation stands on "above 10% needs approval" (utils/discountApproval.js).
 * `priceKey` lets the approver's click say which prices they looked at.
 */
export function shapeApproval(q) {
  const a = approvalState(q);
  const c = a.current;
  return {
    state: a.state,
    threshold: APPROVAL_THRESHOLD_PERCENT,
    percent: a.percent,
    maxLinePercent: a.maxLinePercent,
    totalPercent: a.totalPercent,
    priceKey: a.state === 'not_needed' ? null : priceKeyOf(q),
    reason: c?.reason || null,
    requestedByName: c?.requestedByName || null,
    requestedAt: c?.requestedAt || null,
    decidedByName: c?.decidedByName || null,
    decidedAt: c?.decidedAt || null,
    note: c?.note || null,
  };
}

/** The stored approval is kept only while the prices it was given on are unchanged. */
const approvalSurvives = (q, set) => !!q.discountApproval?.priceKey
  && q.discountApproval.priceKey === priceKeyOf({ items: set.items, totalAmount: set.totalAmount, discount: set.discount });

/** The order's copy of the approval (Order.discountApproval), or null when none was needed. */
function approvalForOrder(q) {
  const { state, current: a } = approvalState(q);
  if (state !== 'approved') return null;
  return {
    percent: a.percent,
    maxLinePercent: a.maxLinePercent,
    totalPercent: a.totalPercent,
    reason: a.reason,
    requestedBy: a.requestedBy,
    requestedByName: a.requestedByName || '',
    requestedAt: a.requestedAt,
    approvedBy: a.decidedBy,
    approvedByName: a.decidedByName || '',
    approvedRole: a.decidedRole,
    approvedAt: a.decidedAt,
    note: a.note || '',
    quotationVersion: q.version,
  };
}

const NEEDS_APPROVAL = (verb) => `This quotation's discount is above ${APPROVAL_THRESHOLD_PERCENT}% of the website price, so it needs approval from the GTM head or an admin before it can be ${verb}. Use "Request approval".`;

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
    subtotal: q.subtotal ?? q.totalAmount,
    discount: shapeDiscount(q.discount),
    totalAmount: q.totalAmount,
    approval: shapeApproval(q),
    notes: q.notes || '',
    validUntil: q.validUntil,
    salesPerson: q.salesUser?.name || null,
    orderId: q.order ? idOf(q.order) : null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    revisions: (q.revisions || []).map((r) => ({
      version: r.version,
      totalAmount: r.totalAmount,
      discount: shapeDiscount(r.discount),
      savedAt: r.savedAt,
      savedByName: r.savedByName || null,
      // This version had been accepted; the edit cancelled its unpaid order.
      wasAccepted: !!r.order,
    })),
  };
}

export function mayRead(actor, q) {
  return isAdmin(actor) || isSalesHead(actor) || (canSell(actor) && idOf(q.salesUser) === idOf(actor._id));
}
export function mayAct(actor, q) {
  return canSell(actor) && (isSalesHead(actor) || idOf(q.salesUser) === idOf(actor._id));
}

export async function loadReadable(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Quotation not found.', 404);
  const q = await salesQuotationRepository.model.findById(id).populate('salesUser', 'name').lean();
  if (!q || !mayRead(actor, q)) throw fail('Quotation not found.', 404);
  return q;
}

async function loadActionable(actor, id, { allow = ['open'] } = {}) {
  const q = await loadReadable(actor, id);
  if (!mayAct(actor, q)) throw fail('You can only change your own quotations.', 403);
  if (!allow.includes(q.status)) throw fail(`This quotation is already ${q.status}.`, 409);
  return q;
}

/**
 * Can an ACCEPTED quotation still be edited? Only while its order is wholly
 * unpaid: no part paid, no bank transfer waiting for accounts. Pure, on the order.
 * @returns {{ allowed: boolean, reason: string|null, payDetailsShared: boolean }}
 */
export function acceptedEditState(order) {
  const no = (reason) => ({ allowed: false, reason, payDetailsShared: false });
  if (!order) return no('The order for this quotation could not be found.');
  if (order.status !== 'awaiting_payment' || order.paymentStatus !== 'pending') {
    return no('This order is already paid or closed, so its quotation can no longer be changed.');
  }
  if ((order.paymentParts || []).some((p) => p.status === 'paid')) {
    return no('Part of this order is already paid, so its quotation can no longer be changed.');
  }
  if (order.bankTransferPendingAt) {
    return no('A bank transfer is waiting for accounts to check on this order. Wait until they confirm or reject it.');
  }
  return { allowed: true, reason: null, payDetailsShared: !!order.salesPayDetails?.method };
}

/** New quotation. Lines are priced exactly as a sales order's would be. */
export async function createQuotation(actor, input, req) {
  if (!canSell(actor)) throw fail('Only the GTM head and GTM leads can create quotations.', 403);
  const { lines, subtotal, totalAmount: total, discount } = await priceQuotation(actor, input);
  const customer = cleanCustomer(input.customer);
  const rep = await salesRepRepository.findOrCreateForUser(actor);
  const _id = new mongoose.Types.ObjectId();
  const created = await salesQuotationRepository.create({
    _id,
    number: quotationNumberFor(_id),
    version: 1,
    status: 'open',
    customer,
    shippingAddress: cleanAddress(input.shippingAddress, customer),
    items: storeLines(lines),
    subtotal,
    ...(discount && { discount }),
    totalAmount: total,
    notes: input.notes ? String(input.notes).slice(0, 1000) : '',
    salesUser: actor._id,
    salesRep: rep._id,
    validUntil: new Date(Date.now() + QUOTATION_VALID_DAYS * DAY),
  });
  auditLogger.logAction(req, 'CREATE', 'SalesQuotation', created._id, {
    totalAmount: total, lines: lines.length, customLines: lines.filter((l) => l.custom).length,
    ...(discount && { discountPercent: discount.percent, discountAmount: discount.amount, discountReason: discount.reason }),
  });
  return shapeQuotation({ ...(created.toObject?.() ?? created), salesUser: { _id: actor._id, name: actor.name } });
}

/** The fields an edit writes, and the revision it keeps of the version it replaces. */
function editChanges(actor, q, priced, input) {
  const customer = cleanCustomer(input.customer);
  return {
    set: {
      customer,
      shippingAddress: cleanAddress(input.shippingAddress, customer),
      items: storeLines(priced.lines),
      subtotal: priced.subtotal,
      totalAmount: priced.totalAmount,
      notes: input.notes ? String(input.notes).slice(0, 1000) : '',
      validUntil: new Date(Date.now() + QUOTATION_VALID_DAYS * DAY),
      ...(priced.discount && { discount: priced.discount }),
    },
    unset: {
      ...(priced.discount ? {} : { discount: '' }),
      // A price change voids the approval: the new prices need their own.
      ...(q.discountApproval && !approvalSurvives(q, {
        items: storeLines(priced.lines), totalAmount: priced.totalAmount, discount: priced.discount,
      }) && { discountApproval: '' }),
    },
    revision: {
      version: q.version,
      items: q.items,
      subtotal: q.subtotal ?? q.totalAmount,
      ...(q.discount?.percent && { discount: q.discount }),
      totalAmount: q.totalAmount,
      savedAt: new Date(),
      savedBy: actor._id,
      savedByName: actor.name || '',
      ...(q.status === 'accepted' && q.order && { order: q.order }),
    },
  };
}

const auditDiscount = (d) => (d ? { discountPercent: d.percent, discountAmount: d.amount, discountReason: d.reason } : { discountPercent: 0 });

/**
 * Edit a quotation: re-priced, version + 1, validity restarts, old version kept.
 * Open → edited in place. Accepted (customer agreed, nothing paid yet) → see
 * reopenAccepted: the old order and its links are retired and it is open again.
 */
export async function updateQuotation(actor, id, input, req) {
  const q = await loadActionable(actor, id, { allow: ['open', 'accepted'] });
  if (q.status === 'accepted') return reopenAccepted(actor, q, input, req);

  const priced = await priceQuotation(actor, input, q.discount);
  const { set, unset, revision } = editChanges(actor, q, priced, input);
  const updated = await salesQuotationRepository.model.findOneAndUpdate(
    // The version guard makes two concurrent edits a clean conflict, not a lost update.
    { _id: q._id, status: 'open', version: q.version },
    { $set: set, ...(Object.keys(unset).length && { $unset: unset }), $inc: { version: 1 }, $push: { revisions: revision } },
    { new: true },
  ).populate('salesUser', 'name').lean();
  if (!updated) throw fail('Someone else changed this quotation just now — reload it and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, {
    version: updated.version, totalAmount: priced.totalAmount, ...auditDiscount(priced.discount),
    ...(unset.discountApproval !== undefined && { approvalCleared: q.discountApproval.status }),
  });
  return shapeQuotation(updated);
}

/**
 * Edit after the customer accepted. Order of steps matters — money first:
 *   1. the new lines + discount are priced and checked (nothing changed yet);
 *   2. the order must be wholly unpaid (acceptedEditState); if the customer was
 *      given bank / QR details, the seller must confirm they have not paid;
 *   3. every waiting Razorpay link is cancelled AT RAZORPAY, so the old amount can
 *      no longer be paid. A link Razorpay will not cancel (just paid) stops here;
 *   4. one transaction: the quotation re-opens as the next version (compare-and-set
 *      on its version and order) AND the order is cancelled — without a customer
 *      email — re-checked unpaid inside the transaction, so a payment or bank
 *      transfer recorded meanwhile aborts the whole edit.
 * If step 4 fails after step 3, the order is merely unpaid with its links
 * cancelled — the seller can request payment again. Never a charge with no order.
 */
async function reopenAccepted(actor, q, input, req) {
  const priced = await priceQuotation(actor, input, q.discount);

  const order = q.order ? await orderRepository.model.findById(q.order) : null;
  const state = acceptedEditState(order);
  if (!state.allowed) throw fail(state.reason, 409);
  if (state.payDetailsShared && input.confirmNotPaid !== true && input.confirmNotPaid !== 'true') {
    throw fail('The customer has your bank / GPay QR details. Check with them that they have not paid yet, then tick the box and save again.', 409);
  }

  if ((order.paymentParts || []).length) await retireAllParts(order);
  await retireCurrentLink(order);
  // The links are dead at Razorpay: say so on the order, so its payment picture is true
  // even if the rest of the edit fails and the order stays.
  if ((order.paymentParts || []).some((p) => p.status === 'pending')) {
    await orderRepository.model.updateOne(
      { _id: order._id, status: 'awaiting_payment', paymentStatus: 'pending' },
      { $set: { 'paymentParts.$[p].status': 'cancelled', 'paymentParts.$[p].cancelledAt': new Date() } },
      { arrayFilters: [{ 'p.status': 'pending' }] },
    );
  }

  const { set, unset, revision } = editChanges(actor, q, priced, input);
  const nextNumber = printedNumber({ number: q.number, version: q.version + 1 });
  const updated = await salesQuotationRepository.inTransaction(async (session) => {
    const reopened = await salesQuotationRepository.model.findOneAndUpdate(
      { _id: q._id, status: 'accepted', order: order._id, version: q.version },
      {
        $set: { ...set, status: 'open', order: null, acceptedAt: null, acceptedBy: null },
        $unset: { ...unset, hold: '' },
        $inc: { version: 1 },
        $push: { revisions: revision },
      },
      { new: true, session },
    ).populate('salesUser', 'name').lean();
    if (!reopened) throw fail('Someone else changed this quotation just now — reload it and try again.', 409);

    const stillUnpaid = await orderRepository.model.findOne({
      _id: order._id,
      status: 'awaiting_payment',
      paymentStatus: 'pending',
      bankTransferPendingAt: null,
      paymentParts: { $not: { $elemMatch: { status: 'paid' } } },
    }).session(session).select('_id').lean();
    if (!stillUnpaid) throw fail('A payment was recorded on this order just now, so the quotation was not changed. Reload it.', 409);

    const result = await orderStatusService.updateOrderStatus(String(order._id), 'cancelled', {
      userId: actor._id,
      isAdmin: false,
      // 'system', not 'admin': a replaced unpaid order is no support work item (no
      // money to refund), so it must not raise the support inbox's cancel alert.
      cancelledBy: 'system',
      reason: 'customer_request',
      notes: `Replaced: quotation ${printedNumber(q)} was edited to ${nextNumber} by ${actor.name} — the customer accepts the new version`,
      // An edit, not a cancellation, as far as the customer is concerned.
      suppressStatusEmail: true,
      session,
      deferSpinVoid: true, // voided below, after the commit
    });
    if (!result?.success) throw fail(`The old order could not be closed, so nothing was changed: ${result?.message || 'please try again'}.`, 409);
    return reopened;
  });

  // An unpaid order has no prize to give back — but the clawback is idempotent and
  // the order IS cancelled, so run it as every cancel does (it cannot run in-transaction).
  await voidSpinForOrder(order._id).catch((err) => console.error('[Quotation] spin clawback after edit failed:', err?.message));

  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, {
    change: 'edited_after_accept',
    version: updated.version,
    replacedOrder: idOf(order._id),
    previousTotal: q.totalAmount,
    totalAmount: priced.totalAmount,
    ...auditDiscount(priced.discount),
    ...(unset.discountApproval !== undefined && { approvalCleared: q.discountApproval.status }),
    payDetailsShared: state.payDetailsShared,
  });
  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'cancelled_quotation_edited', quotation: idOf(q._id) });
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
  if (toPaise(totalOf(lineItems)) !== toPaise(q.subtotal ?? q.totalAmount)) {
    throw fail('Prices changed since this quotation. Edit it to refresh the prices, then accept it.', 409);
  }
  // The discount is re-derived from the stored percent, never read back as a figure.
  const priced = priceWithDiscount(totalOf(lineItems), q.discount?.percent ? q.discount : null);
  if (toPaise(priced.total) !== toPaise(q.totalAmount)) {
    throw fail('The total no longer matches this quotation. Edit it and save it again, then accept it.', 409);
  }
  const salesDiscount = q.discount?.percent ? { ...q.discount, amount: priced.amount } : null;
  // Above 10% off the website price: only with an approval for these exact prices.
  // The lines were just re-priced and matched, so the stored quotation IS the price.
  if (isBlocked(q)) throw fail(NEEDS_APPROVAL('accepted'), 409);
  const discountApproval = approvalForOrder(q);

  // Claim first, so two "accept" clicks can never create two orders. An approved
  // quotation is claimed only at the version that was checked, so an edit landing
  // meanwhile (new prices, approval voided) cannot ride on the old approval.
  const claim = { $set: { status: 'accepted', acceptedAt: new Date(), acceptedBy: actor._id } };
  const claimed = discountApproval
    ? await salesQuotationRepository.model.findOneAndUpdate(
      { _id: q._id, status: 'open', version: q.version, 'discountApproval.status': 'approved', 'discountApproval.priceKey': q.discountApproval.priceKey },
      claim, { new: true },
    ).lean()
    : await salesQuotationRepository.updateIfOpen(q._id, claim);
  if (!claimed) throw fail('This quotation was changed just now — reload it.', 409);

  let order;
  try {
    ({ order } = await createOfflineOrderRecord({
      body: {}, // retail buyer: no GSTIN block from the panel
      email: q.customer.email || phoneOnlyEmailFor(q.customer.phone),
      phone: q.customer.phone,
      alternatePhone: q.customer.alternatePhone || '',
      name: q.customer.name,
      lineItems,
      shippingAddress: q.shippingAddress,
      discount: priced.amount,
      salesDiscount,
      discountApproval,
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
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, {
    change: 'accepted', order: idOf(order._id), totalAmount: order.totalAmount,
    ...(discountApproval && { approvedDiscountPercent: discountApproval.percent, approvedBy: idOf(discountApproval.approvedBy) }),
  });
  return { quotation: shapeQuotation({ ...claimed, order: order._id, salesUser: q.salesUser }), orderId: idOf(order._id) };
}

/**
 * One quotation. An accepted one also says whether it can still be edited
 * (`editAfterAccept`), from its order's payment state.
 */
export async function getQuotation(actor, id) {
  const q = await loadReadable(actor, id);
  const shaped = shapeQuotation(q);
  if (q.status === 'accepted' && q.order) {
    const order = await orderRepository.model.findById(q.order)
      .select('status paymentStatus paymentParts.status bankTransferPendingAt salesPayDetails.method').lean();
    shaped.editAfterAccept = mayAct(actor, q)
      ? acceptedEditState(order)
      : { allowed: false, reason: 'Only the seller or the GTM head can change this quotation.', payDetailsShared: false };
  }
  return shaped;
}

/*
  The quotations list's search, filters and sort. Status tabs as before; `q`
  finds the quotation number, customer name / phone / email / city, product
  names and an exact amount; `seller` (head and admin only) narrows to one
  salesman; `from` / `to` is when it was created. "Follow-up date" sorts only
  the On hold tab — the only one where every row has one — and is ignored on
  the others rather than refused, so a stale link still opens.
*/
// Newest / oldest go by _id, which MongoDB stamps with the moment the quotation
// was created (nothing back-dates one): the same order as createdAt, but served by
// the existing { salesUser, _id } / { status, _id } / _id indexes rather than
// sorted in memory.
export const QUOTATION_SORTS = Object.freeze({
  newest: { field: '_id', dir: -1, type: 'objectId', unique: true },
  oldest: { field: '_id', dir: 1, type: 'objectId', unique: true },
  amount_desc: { field: 'totalAmount', dir: -1, type: 'number' },
  amount_asc: { field: 'totalAmount', dir: 1, type: 'number' },
  follow_up: { field: 'hold.until', dir: 1, type: 'date' },
});
const QUOTATION_SEARCH_FIELDS = Object.freeze([
  'number', 'customer.name', 'customer.phone', 'customer.email', 'shippingAddress.city', 'items.name',
]);
const SUMMARY_CAP = 1000;
const seesTeam = (actor) => isSalesHead(actor) || isAdmin(actor);

/** The Mongo query for a viewer and a set of list filters (exported for tests). */
export function quotationListQuery(actor, f = {}, now = new Date()) {
  const visible = seesTeam(actor)
    ? (isObjectId(f.seller) ? { salesUser: new mongoose.Types.ObjectId(f.seller) } : {})
    : { salesUser: actor._id };
  const range = istRange(f.from, f.to);
  // "Q-0042-v2" is how a revised quotation is printed; the number is stored without the version.
  const words = searchWords(String(f.q ?? '').replace(/^#/, '').replace(/-v\d+\b/gi, ''));
  return and(
    visible,
    ['open', 'accepted', 'cancelled'].includes(f.status) ? { status: f.status } : null,
    // "Needs approval": open, a discount request waiting for the head / an admin.
    f.status === 'approval' ? { status: 'open', 'discountApproval.status': 'pending' } : null,
    // "Open" is the active list: on-hold quotations leave it until their follow-up
    // date, then come back (marked due). "On hold" lists the parked ones.
    f.status === 'open' ? notHeldFilter('hold', now) : null,
    f.status === 'on_hold' ? { status: 'open', ...heldFilter('hold', now) } : null,
    range ? { createdAt: range } : null,
    searchClauses(words, QUOTATION_SEARCH_FIELDS, (w) => {
      const n = amountOf(w);
      return n ? [{ totalAmount: n }] : [];
    }),
  );
}

/** The sort a list asks for; "follow-up date" only on the On hold tab. */
export function quotationListSort(f = {}) {
  const ok = QUOTATION_SORTS[f.sort] && (f.sort !== 'follow_up' || f.status === 'on_hold');
  return ok ? f.sort : 'newest';
}

/**
 * "My quotations" (seller) or every quotation (GTM head, admin), keyset pages.
 * Search, filters and sort as in quotationListQuery / quotationListSort; the
 * first page also says how many match and what they add up to.
 */
export async function listQuotations(actor, params = {}) {
  if (!canSell(actor) && !isAdmin(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const { items, ...page } = await keysetPage({
    query: quotationListQuery(actor, f),
    sorts: QUOTATION_SORTS,
    sortName: quotationListSort(f),
    cursor: f.cursor,
    pageSize: PAGE_SIZE,
    find: (q, o) => salesQuotationRepository.page(q, o),
    count: (q) => salesQuotationRepository.summary(q, SUMMARY_CAP),
  });
  return { ...page, quotations: items.map((q) => shapeQuotation(q)), scope: seesTeam(actor) ? 'team' : 'mine' };
}

/** The quotation PDF — same layout as before; never carries a payment link. */
export async function getQuotationDocument(actor, id) {
  const q = await loadReadable(actor, id);
  if (q.status === 'cancelled') throw fail('This quotation was cancelled.', 409);
  // Not shared with the customer until a discount above 10% is approved. An accepted
  // one already passed this at accept (and its order prints from here too).
  if (q.status === 'open' && isBlocked(q)) throw fail(NEEDS_APPROVAL('shared'), 409);
  const doc = printableQuotation(q);
  const buffer = await renderQuotationPdf(doc);
  return { buffer, filename: `Quotation-${printedNumber(q)}.pdf` };
}

/** What a saved quotation prints: its own lines and prices. */
function printableQuotation(q) {
  const built = buildQuotation({
    _id: q._id,
    createdAt: q.revisions?.length ? q.revisions[q.revisions.length - 1].savedAt : q.createdAt,
    items: q.items,
    // The quotation's own alternative number rides on the printed address.
    shippingAddress: { ...q.shippingAddress, alternatePhone: q.customer.alternatePhone || '' },
    user: { name: q.customer.name, email: q.customer.email, phone: q.customer.phone },
    subtotal: q.subtotal ?? q.totalAmount,
    discount: q.discount?.amount || 0,
    salesDiscount: q.discount?.percent ? q.discount : undefined,
    totalAmount: q.totalAmount,
    shippingCost: 0,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
  });
  return { ...built, number: printedNumber(q), orderRef: printedNumber(q), validUntil: q.validUntil };
}

/**
 * The quotation behind an order, for the bank-transfer details popup. Older sales
 * orders have no saved quotation but still print one from the order itself. null
 * when there is none to show. `pdf` is set only for people the PDF routes allow.
 */
export async function quotationDetailsForOrder(actor, order) {
  if (!order || !order.salesUser || order.status === 'cancelled') return null;
  const q = await salesQuotationRepository.model.findOne({ order: order._id }).lean();
  if (q?.status === 'cancelled') return null;
  const b = q ? printableQuotation(q) : buildQuotation(order);
  return {
    number: b.number,
    date: b.date,
    validUntil: b.validUntil,
    customer: { name: b.customer.name, phone: b.customer.phone, alternatePhone: b.customer.alternatePhone || '', address: b.customer.address },
    lines: b.lines.map(({ n, name, quantity, listPrice, offerPrice, amount }) => ({ n, name, quantity, listPrice, offerPrice, amount })),
    subtotal: b.subtotalAtList,
    discount: b.discount,
    shipping: b.shipping,
    total: b.total,
    totalInWords: b.totalInWords,
    pdf: mayRead(actor, q || order) ? { quotationId: q ? idOf(q._id) : null, orderId: idOf(order._id) } : null,
  };
}

/** The quotation an order came from, if any (for the order screen). */
export async function quotationForOrder(orderId) {
  const q = await salesQuotationRepository.findByOrder(orderId);
  return q ? { id: idOf(q._id), number: printedNumber(q) } : null;
}

export default { createQuotation, updateQuotation, cancelQuotation, acceptQuotation, holdQuotation, resumeQuotation, getQuotation, listQuotations, getQuotationDocument };
