/**
 * A sales customer paid by bank transfer — not the website, not a payment link.
 *
 *   GTM records it  →  accounts (or the admin) finds it in the bank  →  the order is paid.
 *
 * ── Why a person confirms ───────────────────────────────────────────────────
 * Every other way an order becomes paid is a signature-verified Razorpay event.
 * A bank-transfer screenshot is not that: it can be wrong, old, or edited. So
 * recording one changes nothing about the money. The order stays unpaid until
 * someone who can see the company bank account confirms the credit — the same
 * `manual_confirmation` path the admin's "offline sale, already paid" uses
 * (offlineOrderService), with the transfer kept as the record of why.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - one payment per order: recording cancels the order's live payment links
 *     FIRST (if Razorpay refuses — the customer may have just paid online — nothing
 *     is recorded), and while a transfer waits, no new link can be issued and the
 *     sales order cannot be cancelled
 *   - the full amount only: a transfer equals the order total, and an order with a
 *     part already paid by link cannot take one
 *   - one UTR, one order: unique over pending + confirmed transfers
 *   - confirm and reject happen once however often they are clicked, inside a
 *     transaction with the order, so the order is never paid without its transfer
 *     confirmed (or the other way round); the paid-order side effects (invoice,
 *     team alerts) then run exactly once, through the same routine a Razorpay
 *     payment uses
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import bankTransferRepository from '../repositories/bankTransferRepository.js';
import razorpayService from './razorpayService.js';
import orderStatusService from './orderStatusService.js';
import { retireAllParts } from './salesPaymentService.js';
import { retireCurrentLink } from './salesOrderService.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { MAX_ATTACHMENTS } from '../config/attachments.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const BANK_TRANSFER_FOLDER = 'bank-transfers'; // a PRIVATE prefix (storage/assetScope.js)
export const MAX_TRANSFER_FILES = MAX_ATTACHMENTS;
const PAGE_SIZE = 25;
const PAID_ON_MAX_AGE_DAYS = 90;

const STATUS_LABELS = Object.freeze({
  pending: 'Waiting for accounts to check the bank',
  confirmed: 'Confirmed — order paid',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn by GTM',
});

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const paise = (rupees) => Math.round(Number(rupees) * 100);
const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;

/** Accounts and the admin: the people who can see the company bank account. */
export const mayVerify = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
/** Who sees every transfer: the verifiers and the GTM head. GTM leads see their own. */
const seesAll = (u) => mayVerify(u) || isSalesHead(u);

// ── Input ───────────────────────────────────────────────────────────────────

/** The bank's reference as typed, and the form uniqueness is checked on. */
export function cleanReference(raw) {
  const reference = String(raw ?? '').trim();
  const referenceKey = reference.toUpperCase().replace(/[\s\-/]/g, '');
  if (!/^[A-Z0-9]{6,30}$/.test(referenceKey) || reference.length > 40) {
    throw fail('Enter the UTR / bank reference from the screenshot (6–30 letters and numbers).', 400);
  }
  return { reference, referenceKey };
}

/** 'YYYY-MM-DD' → a date no later than tomorrow (IST slack) and no older than 90 days. */
export function cleanPaidOn(raw, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? ''));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw fail('Enter the date the customer paid.', 400);
  if (d.getTime() > now + 24 * 60 * 60 * 1000) throw fail('The payment date cannot be in the future.', 400);
  if (d.getTime() < now - PAID_ON_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw fail(`The payment date is more than ${PAID_ON_MAX_AGE_DAYS} days ago — ask accounts to record it.`, 400);
  }
  return d;
}

/** Check every file's bytes before anything is stored or claimed. */
function checkFiles(files) {
  const checked = checkAttachments(files, { noun: 'screenshot' });
  if (!checked.length) throw fail('Add the payment screenshot from the customer.', 400);
  return checked;
}

const resourceTypeOf = (f) => (f.contentType === 'application/pdf' ? 'raw' : 'image');
const removeFiles = (stored) => Promise.all(stored.map((f) =>
  deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));

async function storeFiles(checked) {
  return storeAll(checked, async ({ file, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer,
      folder: BANK_TRANSFER_FOLDER,
      basename: `transfer-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType,
      cloudinaryPrivate: true,
    });
    return { publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes, name };
  }, (f) => removeFiles([f]));
}

// ── Shape ───────────────────────────────────────────────────────────────────

/*
  Correcting a typo (UTR, date, note), or withdrawing it: no time limit, while
  accounts has not checked it yet — by whoever recorded it, the salesman on the
  order, the GTM head, or the admin. The amount is always the order total, so it
  is never edited.
*/
const mayEdit = (u, t) => t.status === 'pending' && (
  isAdmin(u) || isSalesHead(u)
  || idOf(t.recordedBy) === idOf(u?._id) || (!!t.salesUser && idOf(t.salesUser) === idOf(u?._id))
);

export function shape(t, viewer) {
  const open = t.status === 'pending' && mayVerify(viewer);
  return {
    id: idOf(t._id),
    orderId: idOf(t.order),
    orderNumber: t.orderNumber,
    customer: t.customer || { name: '', city: '' },
    salesPerson: t.salesUserName || '',
    amount: t.amount,
    reference: t.reference,
    paidOn: t.paidOn,
    note: t.note || '',
    status: t.status,
    statusLabel: STATUS_LABELS[t.status],
    recordedBy: t.recordedByName || '',
    recordedAt: t.createdAt,
    reviewedBy: t.reviewedByName || '',
    reviewedAt: t.reviewedAt || null,
    reviewNote: t.reviewNote || '',
    files: (t.files || []).map((f) => ({ id: idOf(f._id), name: f.name || '', contentType: f.contentType, bytes: f.bytes })),
    can: { confirm: open, reject: open, edit: mayEdit(viewer, t), withdraw: mayEdit(viewer, t) },
    editableUntil: null, // no time limit any more
  };
}

// ── Chat ────────────────────────────────────────────────────────────────────

/** #accounts (who confirms) and #GTM (who sold it), threaded by order. Never blocks money. */
async function tellChat(t, action, text, { mentionSeller = false } = {}) {
  try {
    const admins = (await userRepository.findChatUsers()).filter((u) => u.role === 'admin').map((u) => idOf(u));
    const mentions = [...admins, ...(mentionSeller && t.salesUser ? [idOf(t.salesUser)] : [])];
    await Promise.all(['team:accounts', 'team:sales'].map((space) => postSystemMessage(space, text, {
      key: `banktransfer-${idOf(t._id)}-${action}${action === 'edited' ? `-${(t.history || []).length}` : ''}`,
      mentions,
      threadOrder: idOf(t.order),
      orderIds: [idOf(t.order)],
    })));
  } catch (err) {
    console.error('[BankTransfer] chat update failed (ignored):', err.message);
  }
}

// ── Record (GTM) ────────────────────────────────────────────────────────────

/**
 * @param {{ amount, reference, paidOn, note? }} input
 * @param {Array} files multer files (field `proof`), 1–3
 */
export async function recordBankTransfer(actor, orderId, input = {}, files = [], req) {
  if (!isAdmin(actor) && !canSell(actor)) throw fail('Only GTM and the admin record bank transfers.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name' }, { path: 'salesUser', select: 'name' }]);
  if (!order || !order.salesUser) throw fail('Order not found.', 404);
  if (!isAdmin(actor) && !isSalesHead(actor) && idOf(order.salesUser) !== idOf(actor._id)) {
    throw fail('You can only record payments on your own orders.', 403);
  }
  if (order.paymentStatus !== 'pending' || order.status !== 'awaiting_payment') throw fail('This order is already paid or closed.', 409);
  if (order.bankTransferPendingAt) throw fail('A bank transfer is already waiting for accounts on this order.', 409);
  if ((order.paymentParts || []).some((p) => p.status === 'paid')) {
    throw fail('Part of this order is already paid by link, so a bank transfer cannot cover it. Ask accounts to record the rest.', 409);
  }
  if (!Number.isFinite(Number(input.amount)) || paise(input.amount) !== paise(order.totalAmount)) {
    throw fail(`A bank transfer must be for the full order amount: ${inr(order.totalAmount)}.`, 400);
  }
  const { reference, referenceKey } = cleanReference(input.reference);
  const paidOn = cleanPaidOn(input.paidOn);
  const note = String(input.note || '').trim().slice(0, 500);
  const checked = checkFiles(files);

  const dup = await bankTransferRepository.findActiveByReference(referenceKey);
  if (dup) throw fail(`This UTR is already recorded on order ${dup.orderNumber}.`, 409);

  // Claim the order: only one transfer waits at a time, and only on a still-unpaid order.
  const claimed = await orderRepository.model.findOneAndUpdate(
    {
      _id: order._id, status: 'awaiting_payment', paymentStatus: 'pending',
      bankTransferPendingAt: null, paymentParts: { $not: { $elemMatch: { status: 'paid' } } },
    },
    { $set: { bankTransferPendingAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw fail('This order changed just now — refresh and try again.', 409);
  const release = () => orderRepository.model.updateOne({ _id: order._id }, { $unset: { bankTransferPendingAt: '' } }).catch(() => {});

  // Kill every way left to pay online. If Razorpay will not cancel a link, the
  // customer may have just paid with it: stop, and record nothing.
  try {
    if ((order.paymentParts || []).length) await retireAllParts(order);
    await retireCurrentLink(order);
  } catch (err) {
    await release();
    throw err;
  }
  const now = new Date();
  const hasParts = (order.paymentParts || []).some((p) => p.status === 'pending');
  const linkLive = order.paymentLinkId && order.paymentLinkExpiresAt && new Date(order.paymentLinkExpiresAt) > now;
  if (hasParts || linkLive) {
    await orderRepository.model.updateOne(
      { _id: order._id },
      {
        $set: {
          ...(hasParts && { 'paymentParts.$[p].status': 'cancelled', 'paymentParts.$[p].cancelledAt': now }),
          ...(linkLive && { paymentLinkExpiresAt: now }),
        },
      },
      hasParts ? { arrayFilters: [{ 'p.status': 'pending' }] } : {},
    );
  }

  let stored = [];
  let doc;
  try {
    stored = await storeFiles(checked);
    doc = await bankTransferRepository.create({
      order: order._id,
      orderNumber: orderNumber(order),
      salesUser: order.salesUser?._id || order.salesUser,
      salesUserName: order.salesUser?.name || '',
      customer: {
        name: order.shippingAddress?.fullName || order.user?.name || '',
        city: [order.shippingAddress?.city, order.shippingAddress?.state].filter(Boolean).join(', '),
      },
      amount: order.totalAmount,
      reference,
      referenceKey,
      paidOn,
      note,
      files: stored,
      status: 'pending',
      active: true,
      recordedBy: actor._id,
      recordedByName: actor.name || '',
      history: [{ at: now, by: actor._id, byName: actor.name || '', action: 'recorded', note }],
    });
  } catch (err) {
    await removeFiles(stored);
    await release();
    if (err?.code === 11000) throw fail('This UTR was just recorded on another order.', 409);
    throw err;
  }

  auditLogger.logAction(req, 'CREATE', 'BankTransfer', doc._id, { orderId: idOf(order._id), amount: doc.amount, reference });
  await tellChat(doc, 'recorded',
    `🏦 ${doc.orderNumber} — ${doc.customer.name || 'the customer'} paid ${inr(doc.amount)} by bank transfer `
    + `(UTR ${reference}, ${paidOn.toISOString().slice(0, 10)}), recorded by ${actor.name}. Not paid on the website — `
    + 'the payment links were cancelled. Accounts: please check the bank and confirm or reject it.');
  return shape(doc, actor);
}

/** Fix the UTR, the date paid or the note on a transfer accounts has not checked yet. */
export async function editBankTransfer(actor, id, input = {}, req) {
  const t0 = await loadVisible(actor, id);
  if (!mayEdit(actor, t0)) {
    throw fail(t0.status !== 'pending'
      ? 'Accounts has already checked this transfer, so it can no longer be edited.'
      : 'Only whoever recorded it, the salesman on the order, the GTM head or the admin can edit it.', 403);
  }
  const set = {};
  const changes = [];
  if (input.reference != null && String(input.reference).trim() !== t0.reference) {
    const { reference, referenceKey } = cleanReference(input.reference);
    const dup = await bankTransferRepository.findActiveByReference(referenceKey);
    if (dup && idOf(dup._id) !== idOf(t0._id)) throw fail(`This UTR is already recorded on order ${dup.orderNumber}.`, 409);
    Object.assign(set, { reference, referenceKey });
    changes.push(`UTR ${t0.reference} → ${reference}`);
  }
  if (input.paidOn != null && input.paidOn !== '') {
    const paidOn = cleanPaidOn(input.paidOn);
    if (new Date(paidOn).getTime() !== new Date(t0.paidOn).getTime()) { set.paidOn = paidOn; changes.push('date paid'); }
  }
  if (input.note != null && String(input.note).trim().slice(0, 500) !== (t0.note || '')) {
    set.note = String(input.note).trim().slice(0, 500);
    changes.push('note');
  }
  if (!changes.length) return shape(t0, actor);

  let t;
  try {
    t = await bankTransferRepository.updatePendingIf(t0._id, t0.updatedAt, set,
      { at: new Date(), by: actor._id, byName: actor.name || '', action: 'edited', note: changes.join(', ') });
  } catch (err) {
    if (err?.code === 11000) throw fail('This UTR was just recorded on another order.', 409);
    throw err;
  }
  if (!t) throw fail('This transfer was just updated — refresh and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'BankTransfer', idOf(t._id), { change: 'edited', fields: changes });
  await tellChat(t, 'edited', `✏️ ${t.orderNumber} — ${actor.name} corrected the bank transfer: ${changes.join(', ')}.`);
  return shape(t, actor);
}

/**
 * Take back a transfer recorded by mistake (wrong order, customer had not
 * really paid): the same people who may edit it (mayEdit), with no time limit,
 * while accounts has not checked it. Same effect as a rejection —
 * the order is unpaid again and the UTR is free — but nobody checked the bank,
 * so it is recorded as "withdrawn", not "rejected". One transaction, like reject.
 */
export async function withdrawBankTransfer(actor, id, { note } = {}, req) {
  const t0 = await loadVisible(actor, id);
  if (!mayEdit(actor, t0)) {
    throw fail(t0.status !== 'pending'
      ? 'Accounts has already checked this transfer, so it can no longer be withdrawn.'
      : 'Only whoever recorded it, the salesman on the order, the GTM head or the admin can withdraw it.', 403);
  }
  const reason = String(note || '').trim().slice(0, 500);
  let withdrawnHere = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      withdrawnHere = false;
      const t = await bankTransferRepository.model.findById(id).session(session);
      if (!t || t.status === 'withdrawn') return;
      if (t.status !== 'pending') throw fail('Accounts has already checked this transfer, so it can no longer be withdrawn.', 409);
      const now = new Date();
      t.status = 'withdrawn';
      t.active = false;
      t.history.push({ at: now, by: actor._id, byName: actor.name || '', action: 'withdrawn', note: reason });
      await t.save({ session });
      await orderRepository.model.updateOne({ _id: t.order }, { $unset: { bankTransferPendingAt: '' } }, { session });
      withdrawnHere = true;
    });
  } finally {
    await session.endSession();
  }
  const t = await bankTransferRepository.findById(id);
  if (withdrawnHere) {
    auditLogger.logAction(req, 'UPDATE', 'BankTransfer', id, { change: 'withdrawn', orderId: idOf(t.order) });
    await tellChat(t, 'withdrawn',
      `↩️ ${t.orderNumber} — ${actor.name} withdrew the bank transfer of ${inr(t.amount)} (UTR ${t.reference})${reason ? `: ${reason}` : ''}. `
      + 'Accounts: nothing to check. The order is unpaid again.');
  }
  return shape(t, actor);
}

// ── Confirm / reject (accounts, admin) ──────────────────────────────────────

export async function confirmBankTransfer(actor, id, req) {
  if (!mayVerify(actor)) throw fail('Only accounts and the admin confirm bank transfers.', 403);
  if (!mongoose.isValidObjectId(id)) throw fail('Bank transfer not found.', 404);

  let confirmedHere = false;
  let orderId = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      confirmedHere = false; // re-run on a transient write conflict
      const t = await bankTransferRepository.model.findById(id).session(session);
      if (!t) throw fail('Bank transfer not found.', 404);
      if (t.status === 'confirmed') return; // a second click: already done
      if (t.status !== 'pending') throw fail('This bank transfer was already rejected.', 409);
      const order = await orderRepository.findById(t.order, [], session);
      if (!order) throw fail('Order not found.', 404);
      orderId = idOf(order._id);
      if (order.paymentStatus !== 'pending' || order.status !== 'awaiting_payment') {
        throw fail('This order is already paid or closed — do not confirm. If this money is in the bank, it has to go back to the customer.', 409);
      }
      if (paise(order.totalAmount) !== paise(t.amount)) {
        throw fail(`The order total changed since this was recorded (${inr(t.amount)} → ${inr(order.totalAmount)}). Reject it, and GTM records it again.`, 409);
      }

      const now = new Date();
      t.status = 'confirmed';
      t.reviewedBy = actor._id;
      t.reviewedByName = actor.name || '';
      t.reviewedAt = now;
      t.history.push({ at: now, by: actor._id, byName: actor.name || '', action: 'confirmed' });
      await t.save({ session });

      await orderRepository.model.updateOne(
        { _id: order._id },
        {
          $unset: { bankTransferPendingAt: '' },
          $set: {
            offlinePayment: {
              method: 'bank_transfer', reference: t.reference, paidOn: t.paidOn, amount: t.amount,
              transfer: t._id, confirmedBy: actor._id, confirmedByName: actor.name || '', confirmedAt: now,
            },
          },
        },
        { session },
      );
      const result = await orderStatusService.updateOrderStatus(orderId, 'processing', {
        userId: actor._id,
        isAdmin: true,
        reason: 'manual_confirmation',
        notes: `Bank transfer ${t.reference} (${inr(t.amount)}) found in the bank by ${actor.name}`,
        metadata: { transactionId: t.reference },
        session,
      });
      if (!result?.success) throw new Error(`Failed to update order status: ${result?.message}`);
      confirmedHere = true;
    });
  } finally {
    await session.endSession();
  }

  const t = await bankTransferRepository.findById(id);
  if (confirmedHere) {
    // Invoice, admin + team "paid order" alerts, affiliate, Meta — the one
    // post-payment routine every paid order goes through, once.
    razorpayService._afterOrderPaid(orderId);
    auditLogger.logAction(req, 'UPDATE', 'BankTransfer', id, { change: 'confirmed', orderId, amount: t.amount });
    await tellChat(t, 'confirmed', `✅ ${t.orderNumber} — bank transfer of ${inr(t.amount)} (UTR ${t.reference}) confirmed by ${actor.name}. The order is paid and goes to the stock check.`, { mentionSeller: true });
  }
  return shape(t, actor);
}

export async function rejectBankTransfer(actor, id, { note } = {}, req) {
  if (!mayVerify(actor)) throw fail('Only accounts and the admin reject bank transfers.', 403);
  if (!mongoose.isValidObjectId(id)) throw fail('Bank transfer not found.', 404);
  const reason = String(note || '').trim().slice(0, 500);
  if (reason.length < 3) throw fail('Say why — GTM will pass it on to the customer.', 400);

  let rejectedHere = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      rejectedHere = false;
      const t = await bankTransferRepository.model.findById(id).session(session);
      if (!t) throw fail('Bank transfer not found.', 404);
      if (t.status === 'rejected') return;
      if (t.status !== 'pending') throw fail('This bank transfer was already confirmed — the order is paid.', 409);
      const now = new Date();
      t.status = 'rejected';
      t.active = false;
      t.reviewedBy = actor._id;
      t.reviewedByName = actor.name || '';
      t.reviewedAt = now;
      t.reviewNote = reason;
      t.history.push({ at: now, by: actor._id, byName: actor.name || '', action: 'rejected', note: reason });
      await t.save({ session });
      await orderRepository.model.updateOne({ _id: t.order }, { $unset: { bankTransferPendingAt: '' } }, { session });
      rejectedHere = true;
    });
  } finally {
    await session.endSession();
  }

  const t = await bankTransferRepository.findById(id);
  if (rejectedHere) {
    auditLogger.logAction(req, 'UPDATE', 'BankTransfer', id, { change: 'rejected', orderId: idOf(t.order) });
    await tellChat(t, 'rejected',
      `❌ ${t.orderNumber} — bank transfer of ${inr(t.amount)} (UTR ${t.reference}) rejected by ${actor.name}: ${reason}. `
      + `${t.salesUserName || 'GTM'}: the order is unpaid again — check with the customer, then record it again or send a new payment link.`,
      { mentionSeller: true });
  }
  return shape(t, actor);
}

// ── Read ────────────────────────────────────────────────────────────────────

const encodeCursor = (t) => Buffer.from(`${new Date(t.createdAt).toISOString()}|${t._id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, cid] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(cid || '')) return null;
    return { createdAt, id: new mongoose.Types.ObjectId(cid) };
  } catch {
    return null;
  }
}

function scopeFor(actor) {
  if (seesAll(actor)) return {};
  if (canSell(actor)) return { salesUser: actor._id };
  throw fail('Not authorized.', 403);
}

/** @param {{ status?: 'pending'|'confirmed'|'rejected'|'all', cursor?: string }} q */
export async function listBankTransfers(actor, { status = 'pending', cursor } = {}) {
  const scope = scopeFor(actor);
  const query = { ...scope, ...(status && status !== 'all' ? { status } : {}) };
  const rows = await bankTransferRepository.page(query, { before: decodeCursor(cursor), limit: PAGE_SIZE + 1 });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { transfers: items.map((t) => shape(t, actor)), nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

async function loadVisible(actor, id) {
  const scope = scopeFor(actor);
  if (!mongoose.isValidObjectId(id)) throw fail('Bank transfer not found.', 404);
  const t = await bankTransferRepository.findById(id);
  if (!t || (scope.salesUser && idOf(t.salesUser) !== idOf(actor._id))) throw fail('Bank transfer not found.', 404);
  return t;
}

export async function getBankTransfer(actor, id) {
  return shape(await loadVisible(actor, id), actor);
}

/** One screenshot, streamed through us (never a public link). */
export async function getTransferFile(actor, id, fileId) {
  const t = await loadVisible(actor, id);
  const f = (t.files || []).find((x) => idOf(x._id) === String(fileId));
  if (!f) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(f, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: f.contentType, name: f.name || `${t.orderNumber}-transfer` };
}

/** For the bell: transfers waiting on accounts / the admin. */
export const countPending = () => bankTransferRepository.countPending();

export default {
  recordBankTransfer, confirmBankTransfer, rejectBankTransfer, listBankTransfers, getBankTransfer, getTransferFile, countPending, mayVerify,
};
