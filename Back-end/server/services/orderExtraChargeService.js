/**
 * Extra charges on an already-paid order: GTM asks, Accounts decides, the customer
 * pays, the Admin refunds. The rules are in utils/extraCharge.js; the money lands in
 * razorpayService.processExtraPayment (verified webhook) or
 * bankTransferService.confirmBankTransfer (Accounts found it in the bank) — nothing
 * here marks anything paid.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import razorpayService from './razorpayService.js';
import orderRepository from '../repositories/orderRepository.js';
import orderExtraChargeRepository from '../repositories/orderExtraChargeRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import userRepository from '../repositories/userRepository.js';
import { buildExtraChargeReceipt, orderNumber } from './invoiceService.js';
import { PAYMENT_LINK_TTL_MS } from './offlineOrderService.js';
import { tellExtraChat } from './extraChargeEffects.js';
import { publicEmail } from '../utils/customerContact.js';
import { keysetPage, plainQuery } from '../utils/listQuery.js';
import { OFFLINE_METHODS } from '../config/offlineRefund.js';
import {
  EXTRA_ELIGIBLE_ORDER_STATUSES, MAX_EXTRA_RUPEES, MAX_LIVE_EXTRAS, MAX_NOTE_CHARS, MAX_REASON_CHARS,
  MIN_EXTRA_RUPEES, MIN_REASON_CHARS,
} from '../config/extraCharges.js';
import {
  VISIBLE_TO_CUSTOMER, customerView, extraTotals, idOf, isAdmin, isOrderClosed, liveLink, mayDecide, seesAllExtras, seesOrderExtras,
  sellsThisOrder, statusLabel, toPaise,
} from '../utils/extraCharge.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAGE_SIZE = 25;
const entry = (actor, action, note = '') => ({ at: new Date(), by: actor._id, byName: actor.name || '', action, note });

export function cleanAmount(raw) {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
  if (!Number.isFinite(n) || n < MIN_EXTRA_RUPEES) throw fail(`Enter an amount of at least ${inr(MIN_EXTRA_RUPEES)}.`, 400);
  if (n > MAX_EXTRA_RUPEES) throw fail(`An extra charge cannot be more than ${inr(MAX_EXTRA_RUPEES)}.`, 400);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw fail('Use at most two decimal places.', 400);
  return Math.round(n * 100) / 100;
}

export function cleanReason(raw) {
  const reason = String(raw ?? '').trim();
  if (reason.length < MIN_REASON_CHARS) throw fail('Write the reason for this extra charge. The customer will see it.', 400);
  if (reason.length > MAX_REASON_CHARS) throw fail(`Keep the reason under ${MAX_REASON_CHARS} characters.`, 400);
  return reason;
}

const cleanNote = (raw) => String(raw ?? '').trim().slice(0, MAX_NOTE_CHARS);

const mayManage = (actor, extra) => sellsThisOrder(actor, extra.salesUser) || idOf(extra.requestedBy) === idOf(actor?._id);

/** Plain row for any staff screen. The live link and customer contact stay with those who act on it. */
export function shape(extra, actor, now = Date.now()) {
  const manage = mayManage(actor, extra);
  const decide = mayDecide(actor);
  const unpaid = ['awaiting_accounts', 'approved'].includes(extra.status);
  const link = liveLink(extra, now);
  return {
    id: idOf(extra._id),
    orderId: idOf(extra.order),
    orderNumber: extra.orderNumber,
    customer: extra.customer || { name: '', city: '' },
    salesPerson: extra.salesUserName || '',
    sequence: extra.sequence,
    amount: extra.amount,
    reason: extra.reason,
    customerConfirmed: extra.customerConfirmed,
    status: extra.status,
    statusLabel: statusLabel(extra, now),
    requestedBy: extra.requestedByName || '',
    requestedAt: extra.createdAt,
    decidedBy: extra.decidedByName || '',
    decidedAt: extra.decidedAt || null,
    decisionNote: extra.decisionNote || '',
    paidVia: extra.paidVia || null,
    paidAt: extra.paidAt || null,
    receiptNo: extra.receiptNo || null,
    payUrl: manage || decide ? link?.url || null : null,
    payBy: link?.expiresAt || null,
    bankTransferPending: !!extra.bankTransferPendingAt,
    transferId: idOf(extra.transfer),
    refund: extra.refund ? {
      status: extra.refund.status,
      dueReason: extra.refund.dueReason || '',
      method: extra.refund.method || null,
      reference: extra.refund.offlineReference || extra.refund.razorpayRefundId || '',
      completedAt: extra.refund.completedAt || null,
      failureReason: extra.refund.failureReason || '',
      by: extra.refund.byName || '',
    } : null,
    can: {
      edit: extra.status === 'awaiting_accounts' && manage,
      cancel: unpaid && manage && !extra.bankTransferPendingAt,
      decide: extra.status === 'awaiting_accounts' && decide && (isAdmin(actor) || idOf(extra.requestedBy) !== idOf(actor?._id)),
      sendLink: extra.status === 'approved' && manage && !extra.bankTransferPendingAt && !link,
      recordBank: extra.status === 'approved' && manage && !extra.bankTransferPendingAt,
      refund: isAdmin(actor) && extra.status === 'paid' && (!extra.refund || ['due', 'failed'].includes(extra.refund.status)),
    },
    history: (extra.history || []).map((h) => ({ at: h.at, by: h.byName || '', action: h.action, note: h.note || '' })),
  };
}

async function loadOrder(orderId, populate = []) {
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const order = await orderRepository.findById(orderId, populate);
  if (!order) throw fail('Order not found.', 404);
  return order;
}

async function loadExtra(id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Extra charge not found.', 404);
  const extra = await orderExtraChargeRepository.findById(id);
  if (!extra) throw fail('Extra charge not found.', 404);
  return extra;
}

// ── GTM raises it ───────────────────────────────────────────────────────────

/** @param {{ amount, reason, customerConfirmed, clientKey }} input — nothing else is read */
export async function requestExtra(actor, orderId, input = {}, req) {
  const order = await loadOrder(orderId, [{ path: 'user', select: 'name' }, { path: 'salesUser', select: 'name' }]);
  if (!sellsThisOrder(actor, order.salesUser)) throw fail('You can only add an extra charge on your own orders.', 403);
  if (order.paymentStatus !== 'paid' || !EXTRA_ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
    throw fail('An extra charge can only be added to a paid order that is not cancelled or returned.', 409);
  }
  const amount = cleanAmount(input.amount);
  const reason = cleanReason(input.reason);
  if (input.customerConfirmed !== true && input.customerConfirmed !== 'true') {
    throw fail('Confirm that the customer has agreed to this extra amount.', 400);
  }
  const clientKey = String(input.clientKey ?? '').trim();
  if (!/^[\w-]{8,64}$/.test(clientKey)) throw fail('Please reload the page and try again.', 400);

  const existing = await orderExtraChargeRepository.findByOrderAndKey(order._id, clientKey);
  if (existing) return shape(existing, actor); // the same form sent twice
  if (await orderExtraChargeRepository.countLive(order._id) >= MAX_LIVE_EXTRAS) {
    throw fail(`An order can have at most ${MAX_LIVE_EXTRAS} extra charges.`, 409);
  }

  // Two different extras raised at once can pick the same number: the unique index
  // lets one win, and the other takes the next number.
  let doc = null;
  for (let attempt = 0; attempt < 5 && !doc; attempt += 1) {
    const sequence = (await orderExtraChargeRepository.lastSequence(order._id)) + 1;
    try {
      doc = await orderExtraChargeRepository.create({
        order: order._id,
        orderNumber: orderNumber(order),
        user: idOf(order.user),
        salesUser: idOf(order.salesUser),
        salesUserName: order.salesUser?.name || '',
        customer: {
          name: order.shippingAddress?.fullName || order.user?.name || '',
          city: [order.shippingAddress?.city, order.shippingAddress?.state].filter(Boolean).join(', '),
        },
        sequence,
        clientKey,
        amount,
        reason,
        customerConfirmed: true,
        status: 'awaiting_accounts',
        requestedBy: actor._id,
        requestedByName: actor.name || '',
        history: [entry(actor, 'requested', `${inr(amount)}: ${reason}`)],
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const same = await orderExtraChargeRepository.findByOrderAndKey(order._id, clientKey);
      if (same) return shape(same, actor);
    }
  }
  if (!doc) throw fail('Someone else just added an extra charge to this order — reload and try again.', 409);

  auditLogger.logAction(req, 'CREATE', 'OrderExtraCharge', doc._id, { orderId: idOf(order._id), amount });
  await tellExtraChat(doc, 'requested',
    `➕ ${doc.orderNumber} — ${actor.name} asked for an extra ${inr(amount)}: ${reason}. Accounts: please approve or reject it.`);
  return shape(doc, actor);
}

/** Amount and reason only, and only until Accounts has decided. */
export async function editExtra(actor, id, input = {}, req) {
  const extra = await loadExtra(id);
  if (!mayManage(actor, extra)) throw fail('Only the seller, the GTM head or the admin can edit this.', 403);
  if (extra.status !== 'awaiting_accounts') throw fail('Accounts has already decided this. Cancel it and raise a new one.', 409);
  const amount = input.amount == null ? extra.amount : cleanAmount(input.amount);
  const reason = input.reason == null ? extra.reason : cleanReason(input.reason);
  if (amount === extra.amount && reason === extra.reason) return shape(extra, actor);
  const saved = await orderExtraChargeRepository.transition(
    { _id: extra._id, status: 'awaiting_accounts', updatedAt: extra.updatedAt },
    { $set: { amount, reason }, $push: { history: entry(actor, 'edited', `${inr(extra.amount)} → ${inr(amount)}`) } },
  );
  if (!saved) throw fail('This extra charge changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'edited', amount, previous: extra.amount });
  return shape(saved, actor);
}

/** Before payment only. A live link is cancelled first, or nothing changes. */
export async function cancelExtra(actor, id, input = {}, req) {
  const extra = await loadExtra(id);
  if (!mayManage(actor, extra)) throw fail('Only the seller, the GTM head or the admin can cancel this.', 403);
  if (extra.status === 'cancelled') return shape(extra, actor);
  if (!['awaiting_accounts', 'approved'].includes(extra.status)) throw fail('This extra charge can no longer be cancelled.', 409);
  if (extra.bankTransferPendingAt) throw fail('A bank transfer is waiting for Accounts on this extra. Wait until they confirm or reject it.', 409);
  const link = liveLink(extra);
  if (link) {
    try {
      await razorpayService.cancelPaymentLink(link.id);
    } catch (err) {
      throw fail(`Could not cancel the link — it may have just been paid. Reload in a minute. (${err.message})`, 409);
    }
  }
  const note = cleanNote(input.note);
  const saved = await orderExtraChargeRepository.transition(
    { _id: extra._id, status: extra.status, bankTransferPendingAt: { $exists: false } },
    { $set: { status: 'cancelled', 'links.$[l].status': 'cancelled' }, $push: { history: entry(actor, 'cancelled', note) } },
    { arrayFilters: [{ 'l.status': 'pending' }] },
  );
  if (!saved) throw fail('This extra charge changed just now — reload it.', 409);
  auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'cancelled' });
  await tellExtraChat(saved, 'cancelled', `🚫 ${saved.orderNumber} — ${actor.name} cancelled the extra charge of ${inr(saved.amount)}.`);
  return shape(saved, actor);
}

// ── Accounts decides ────────────────────────────────────────────────────────

async function decide(actor, id, approve, input, req) {
  if (!mayDecide(actor)) throw fail('Only Accounts and the admin can approve or reject an extra charge.', 403);
  const extra = await loadExtra(id);
  const target = approve ? 'approved' : 'rejected';
  if (!isAdmin(actor) && idOf(extra.requestedBy) === idOf(actor._id)) throw fail('You cannot decide your own request.', 403);
  if (extra.status === target) return shape(extra, actor); // a second click
  if (extra.status !== 'awaiting_accounts') throw fail('This extra charge has already been decided.', 409);
  const note = cleanNote(input.note);
  if (!approve && note.length < 3) throw fail('Say why — GTM will pass it on to the customer.', 400);
  if (approve) {
    const order = await loadOrder(extra.order);
    if (isOrderClosed(order)) throw fail('This order has been cancelled or returned, so it cannot take an extra charge.', 409);
  }
  const saved = await orderExtraChargeRepository.transition(
    { _id: extra._id, status: 'awaiting_accounts' },
    {
      $set: { status: target, decidedBy: actor._id, decidedByName: actor.name || '', decidedAt: new Date(), decisionNote: note },
      $push: { history: entry(actor, target, note) },
    },
  );
  if (!saved) {
    const now = await loadExtra(id);
    if (now.status === target) return shape(now, actor);
    throw fail('This extra charge was just changed — reload it.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: target, amount: saved.amount });
  await tellExtraChat(saved, target,
    approve
      ? `✅ ${saved.orderNumber} — Accounts approved the extra ${inr(saved.amount)}. ${saved.salesUserName || 'GTM'}: send the payment link or record the bank transfer.`
      : `❌ ${saved.orderNumber} — Accounts rejected the extra ${inr(saved.amount)}: ${note}.`,
    { mentionSeller: true });
  return shape(saved, actor);
}
export const approveExtra = (actor, id, input = {}, req) => decide(actor, id, true, input, req);
export const rejectExtra = (actor, id, input = {}, req) => decide(actor, id, false, input, req);

// ── Asking the customer to pay ──────────────────────────────────────────────

/** One Razorpay link at a time. A live link is returned as it is, so a double click makes one. */
export async function sendPaymentLink(actor, id, req) {
  const extra = await loadExtra(id);
  if (!mayManage(actor, extra)) throw fail('Only the seller, the GTM head or the admin can send this link.', 403);
  if (extra.status !== 'approved') throw fail('Accounts must approve this extra charge first.', 409);
  if (extra.bankTransferPendingAt) throw fail('A bank transfer is waiting for Accounts on this extra.', 409);
  if (liveLink(extra)) return shape(extra, actor);

  const order = await loadOrder(extra.order, [{ path: 'user', select: 'name email phone' }]);
  if (isOrderClosed(order)) throw fail('This order has been cancelled or returned, so it cannot take an extra charge.', 409);

  const attempt = (extra.links || []).length + 1;
  let link;
  try {
    link = await razorpayService.createPaymentLink(order, {
      name: order.shippingAddress?.fullName || order.user?.name,
      email: publicEmail(order.user?.email || order.guestEmail) || undefined,
      phone: order.shippingAddress?.phone || order.user?.phone,
    }, { extra: { amount: extra.amount, id: idOf(extra._id), sequence: extra.sequence, attempt } });
  } catch (err) {
    if (/maximum amount/i.test(err.message || '')) {
      throw fail('Razorpay refused this amount as more than it allows in one payment. Record a bank transfer instead, or ask Accounts to get the limit raised.', 422);
    }
    throw fail(`Could not create the payment link: ${err.message}`, 502);
  }

  const expiresAt = new Date(Date.now() + PAYMENT_LINK_TTL_MS);
  const saved = await orderExtraChargeRepository.transition(
    { _id: extra._id, status: 'approved', bankTransferPendingAt: { $exists: false }, links: { $size: attempt - 1 } },
    {
      $push: {
        links: { id: link.id, url: link.shortUrl, expiresAt, status: 'pending', createdBy: actor._id, createdAt: new Date() },
        history: entry(actor, 'link_sent', attempt > 1 ? `New link (${attempt})` : ''),
      },
    },
  );
  if (!saved) {
    await razorpayService.cancelPaymentLink(link.id).catch(() => {});
    const now = await loadExtra(id);
    if (liveLink(now)) return shape(now, actor);
    throw fail('This extra charge changed just now — reload it.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'link_sent', amount: saved.amount });
  return shape(saved, actor);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** The extras of one order, and the server's sum. */
export async function listForOrder(actor, orderId) {
  const order = await loadOrder(orderId);
  if (!seesOrderExtras(actor) && !sellsThisOrder(actor, order.salesUser)) throw fail('Not authorized.', 403);
  const extras = await orderExtraChargeRepository.findByOrder(order._id);
  const canAdd = sellsThisOrder(actor, order.salesUser) && order.paymentStatus === 'paid' && EXTRA_ELIGIBLE_ORDER_STATUSES.includes(order.status);
  return { extras: extras.map((e) => shape(e, actor)), totals: extraTotals(order, extras), canAdd };
}

const LIST_SORTS = Object.freeze({ newest: { field: 'createdAt', dir: -1, type: 'date' } });
const LIST_TABS = Object.freeze({
  awaiting_accounts: { status: 'awaiting_accounts' },
  approved: { status: 'approved' },
  paid: { status: 'paid' },
  refund_due: { 'refund.status': { $in: ['due', 'failed', 'processing'], $type: 'string' } },
  closed: { status: { $in: ['rejected', 'cancelled'] } },
});

/** A page of extras: Accounts, the admin and the GTM head see all; a GTM lead their own. */
export async function listExtras(actor, params = {}) {
  const f = plainQuery(params);
  let scope = {};
  if (!seesAllExtras(actor)) {
    if (!sellsThisOrder(actor, actor?._id)) throw fail('Not authorized.', 403);
    scope = { salesUser: actor._id };
  }
  const tab = LIST_TABS[f.tab] ? f.tab : 'awaiting_accounts';
  const { items, ...page } = await keysetPage({
    query: { ...scope, ...LIST_TABS[tab] },
    sorts: LIST_SORTS,
    sortName: 'newest',
    cursor: f.cursor,
    pageSize: PAGE_SIZE,
    find: orderExtraChargeRepository.page,
  });
  return { ...page, tab, extras: items.map((e) => shape(e, actor)) };
}

export const countAwaitingAccounts = () => orderExtraChargeRepository.countAwaitingAccounts();

// ── Refund (admin) ──────────────────────────────────────────────────────────

/** Once the money has truly gone back: customer lifetime spend, payment row, chat. Runs once per refund. */
export async function completeExtraRefund(extra) {
  if (extra.user) await userRepository.decrementSpend(extra.user, { amountPaise: toPaise(extra.amount) });
  if (extra.payment) await paymentRepository.recordRefund(extra.payment, extra.amount, 'extra_charge').catch((err) => console.error('[ExtraCharge] payment refund record failed:', err.message));
  await tellExtraChat(extra, 'refunded', `↩️ ${extra.orderNumber} — the extra charge of ${inr(extra.amount)} has been refunded.`);
}

/**
 * Refund one paid extra in full. Razorpay: against this extra's OWN payment, so the
 * original order's refund limit is untouched. Offline: the money already went back;
 * this records it with its reference (Admin only, as for every offline refund).
 */
export async function refundExtra(actor, id, input = {}, req) {
  if (!isAdmin(actor)) throw fail('Only the admin can refund an extra charge.', 403);
  const extra = await loadExtra(id);
  if (extra.status !== 'paid') throw fail('Only a paid extra charge can be refunded.', 409);
  if (extra.refund && !['due', 'failed'].includes(extra.refund.status)) {
    throw fail('This extra charge is already being refunded or has been refunded.', 409);
  }
  const claimFilter = {
    _id: extra._id,
    status: 'paid',
    $or: [{ refund: { $exists: false } }, { 'refund.status': { $in: ['due', 'failed'] } }],
  };
  const amountPaise = toPaise(extra.amount);
  const byFields = { 'refund.by': actor._id, 'refund.byName': actor.name || '', 'refund.amountPaise': amountPaise };

  if (input.method === 'offline') {
    const reference = String(input.reference ?? '').trim();
    if (reference.length < 3 || reference.length > 120) throw fail('Enter the UTR, cheque or receipt number for this refund.', 400);
    if (!OFFLINE_METHODS.includes(input.offlineMethod)) throw fail('Choose how the money went back.', 400);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86400000) throw fail('Enter a valid refund date.', 400);
    const now = new Date();
    const saved = await orderExtraChargeRepository.transition(claimFilter, {
      $set: {
        'refund.status': 'completed', 'refund.method': 'offline', 'refund.offlineMethod': input.offlineMethod, 'refund.offlineReference': reference,
        'refund.paidAt': paidAt, 'refund.offlineRecordedAt': now, 'refund.offlineRecordedBy': actor._id, 'refund.completedAt': now, ...byFields,
      },
      $push: { history: entry(actor, 'refunded', `Offline: ${reference}`) },
    });
    if (!saved) throw fail('This extra charge changed just now — reload it.', 409);
    auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'refund_offline', amount: extra.amount, reference });
    await completeExtraRefund(saved);
    return shape(saved, actor);
  }

  if (!extra.gatewayPaymentId) {
    throw fail('This extra was paid by bank transfer. Send the money back from the bank, then record it here with the reference.', 422);
  }
  const claimed = await orderExtraChargeRepository.transition(claimFilter, {
    $set: { 'refund.status': 'processing', 'refund.method': 'razorpay', ...byFields },
    $unset: { 'refund.failureReason': '' },
    $push: { history: entry(actor, 'refund_started') },
  });
  if (!claimed) throw fail('This extra charge is already being refunded — reload it.', 409);

  let result;
  try {
    result = await razorpayService.refundPayment(extra.gatewayPaymentId, amountPaise, {
      orderId: idOf(extra.order), extraChargeId: idOf(extra._id), reason: 'extra_charge',
    });
  } catch (err) {
    await orderExtraChargeRepository.transition(
      { _id: extra._id, 'refund.status': 'processing' },
      { $set: { 'refund.status': 'failed', 'refund.failureReason': err.message }, $push: { history: { at: new Date(), action: 'refund_failed', note: err.message.slice(0, 900) } } },
    );
    auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'refund_failed' });
    throw fail(`Razorpay did not accept this refund. Nothing was sent. (${err.message})`, 502);
  }

  auditLogger.logAction(req, 'UPDATE', 'OrderExtraCharge', extra._id, { change: 'refund_sent', amount: extra.amount, refundId: result.refundId });
  const next = await orderExtraChargeRepository.transition(
    { _id: extra._id, 'refund.status': 'processing' },
    { $set: { 'refund.razorpayRefundId': result.refundId, ...(result.status === 'processed' ? { 'refund.status': 'completed', 'refund.completedAt': new Date() } : {}) } },
  );
  // No row back: the refund webhook finished it first and has done the follow-up.
  if (next?.refund?.status === 'completed') await completeExtraRefund(next);
  return shape(next || await loadExtra(id), actor);
}

/** The receipt PDF for staff who may read this order's extras. */
export async function staffReceipt(actor, id) {
  const extra = await loadExtra(id);
  if (!seesOrderExtras(actor) && !sellsThisOrder(actor, extra.salesUser)) throw fail('Not authorized.', 403);
  if (extra.status !== 'paid') throw fail('A receipt exists once the extra charge is paid.', 409);
  return buildExtraChargeReceipt(extra);
}

/** The receipt PDF for the customer: only their own order. */
export async function customerReceipt(user, orderId, id) {
  const extra = await loadExtra(id);
  if (idOf(extra.order) !== String(orderId) || !extra.user || idOf(extra.user) !== idOf(user?._id ?? user?.id)) {
    throw fail('Extra charge not found.', 404);
  }
  if (extra.status !== 'paid') throw fail('A receipt exists once the extra charge is paid.', 409);
  return buildExtraChargeReceipt(extra);
}

/** What the customer's own order page shows. Nothing before Accounts approved. */
export async function forCustomer(order) {
  const rows = (await orderExtraChargeRepository.findByOrder(order._id)).filter((e) => VISIBLE_TO_CUSTOMER.includes(e.status));
  const { extrasPaid, finalAmount } = extraTotals(order, rows);
  return { extras: rows.map((e) => customerView(e)), totals: { extrasPaid, finalAmount } };
}

/** Admin's list of extras the customer is owed. Bounded; the screen shows a count. */
export async function refundsDue(actor) {
  if (!isAdmin(actor)) throw fail('Not authorized.', 403);
  const rows = await orderExtraChargeRepository.model.find({ 'refund.status': { $in: ['due', 'failed', 'processing'] } })
    .sort({ updatedAt: -1 }).limit(100).lean();
  return rows.map((e) => shape(e, actor));
}

