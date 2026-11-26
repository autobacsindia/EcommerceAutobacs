/**
 * "Ship before payment" — a rare customer pays only after seeing the tracking.
 *
 * ── THE FLOW ────────────────────────────────────────────────────────────────────
 *   1. Sales makes the order in the sales panel as usual (unpaid).
 *   2. The ADMIN or ACCOUNTS turns on "Ship before payment" with a reason
 *      (approvePayLater) — only on a B2B order whose type accounts has approved
 *      (utils/salesType.js; owner 2026-11-25). Never on a retail (B2C) order.
 *      The order goes to the teams like a paid one; paymentStatus stays `pending`.
 *   3. The first parcel leaves (shipmentService → afterDispatch): the due date is
 *      set (DUE_DAYS later) and a fresh Razorpay link goes to the customer.
 *   4. The customer pays the link → the VERIFIED webhook marks it paid
 *      (razorpayService.processPaymentSuccess) — or GTM records a bank transfer and
 *      accounts confirms it. Nothing here ever marks an order paid.
 *   5. Past the due date: once per IST day the customer is reminded and the admin +
 *      accounts get one overdue email (sweepPayLater, hourly). The bell counts them.
 *
 * ── RULES (config/payLater.js, owner 2026-11-24/25) ─────────────────────────────
 *   admin or accounts · B2B only, type approved by accounts · a reason is required · no amount limit (owner removed it
 *   2026-11-25) · a customer with an overdue unpaid order cannot get another one.
 *
 * ── ONCE ONLY ───────────────────────────────────────────────────────────────────
 *   Approval: a compare-and-set on status `awaiting_payment` + not paid, inside a
 *   transaction (status change + clearing the old link together). Link: claimed with a CAS (payLater.linkClaimedAt) and saved
 *   only if still unpaid; a link made for an order paid meanwhile is cancelled.
 *   Chasing: claimed per IST day (payLater.lastChasedOn).
 */
import mongoose from 'mongoose';
import * as Sentry from '@sentry/node';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import razorpayService from './razorpayService.js';
import orderStatusService from './orderStatusService.js';
import { retireCurrentLink } from './salesOrderService.js';
import { enqueueNotification } from '../queue/queues.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { PAY_LATER, UNPAID_PAYMENT_STATUSES, payLaterDueFilter } from '../config/payLater.js';
import { publicEmail } from '../utils/customerContact.js';
import {
  paise, istDayKey, dueAtFor, dispatchedAtOf, shapePayLater,
  payLaterHasLeft, payLaterWithdrawFilter, payLaterWithdrawUpdate, lastWithdrawalOf,
} from '../utils/payLater.js';
import { payLaterTypeProblem, shapeSalesType } from '../utils/salesType.js';
import { typeChangeOption } from './salesTypeService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;

const PAGE_SIZE = 25;

/** Who may turn it on: the admin, and accounts (owner 2026-11-25). */
const mayApprove = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
const SWEEP_LIMIT = 200; // per run; the hourly sweep picks up the rest next time
const DAY_SECONDS = 24 * 60 * 60;
const MIN_LINK_AGE_MS = 10 * 60 * 1000; // give the webhook time before asking Razorpay
/** 10:00–19:00 IST: when a reminder SMS and the overdue email may go out. */
export const inChaseHours = (now = new Date()) => {
  const h = new Date(new Date(now).getTime() + 330 * 60 * 1000).getUTCHours();
  return h >= 10 && h < 19;
};

// Best-effort, never throws, a no-op without Redis (queue/queues.js).
const enqueue = (job, data) => enqueueNotification(job, data);

/** Total shipped-and-unpaid across every customer, in paise (index order_pay_later). */
async function outstandingPaise() {
  const [row] = await orderRepository.model.aggregate([
    { $match: payLaterDueFilter() },
    { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
  ]);
  return { paise: paise(row?.total || 0), count: row?.count || 0 };
}

/** The customer's overdue unpaid pay-later order, if any (blocks a new approval). */
function findOverdueFor(userId, now) {
  if (!userId) return null;
  return orderRepository.model.findOne({ user: userId, ...payLaterDueFilter(), 'payLater.dueAt': { $lt: now } })
    .select('_id wpId').lean();
}

// ── 2. Approve ─────────────────────────────────────────────────────────────────

/**
 * Admin: let this unpaid sales order ship before payment.
 * A second click on an approved order returns it unchanged (no second approval).
 */
export async function approvePayLater(actor, orderId, input = {}, req) {
  if (!mayApprove(actor)) throw fail('Only the admin or accounts can let an order ship before payment.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < PAY_LATER.REASON_MIN) throw fail('Write why this customer may pay after dispatch.', 400);
  if (reason.length > PAY_LATER.REASON_MAX) throw fail(`Keep the reason under ${PAY_LATER.REASON_MAX} characters.`, 400);

  const order = await orderRepository.findById(orderId);
  if (!order) throw fail('Order not found.', 404);
  if (order.payLater?.approvedAt) return { order: shapeRow(order), alreadyApproved: true };
  if (!order.salesUser) throw fail('Ship before payment is only for orders made in the sales panel.', 409);
  if (order.status !== 'awaiting_payment' || !UNPAID_PAYMENT_STATUSES.includes(order.paymentStatus)) {
    throw fail('This order is already paid or closed.', 409);
  }
  // B2B only, and only once accounts has approved the type (utils/salesType.js).
  const typeProblem = payLaterTypeProblem(order);
  if (typeProblem) throw fail(typeProblem, 409);
  if (order.bankTransferPendingAt) throw fail('A bank transfer is waiting for accounts on this order. Wait for them first.', 409);
  if ((order.paymentParts || []).length) {
    throw fail('This order is paid in parts. Ship before payment works only for a single full payment.', 409);
  }
  const total = paise(order.totalAmount);
  if (total < 100) throw fail('This order has no amount to collect.', 409);
  const now = new Date();
  const overdue = await findOverdueFor(order.user, now);
  if (overdue) {
    throw fail(`This customer has not paid order ${orderNumber(overdue)}, which is overdue. They cannot ship before paying until it is paid.`, 409);
  }

  // The customer must not be able to pay the old 48-hour link once this is on: the
  // new link goes out after dispatch. If Razorpay will not cancel it, they may have
  // just paid — stop (retireCurrentLink throws a 409).
  const hadLiveLink = !!order.paymentLinkId && !!order.paymentLinkExpiresAt && new Date(order.paymentLinkExpiresAt) > now;
  await retireCurrentLink(order);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const result = await orderStatusService.updateOrderStatus(String(order._id), 'processing', {
        userId: actor._id,
        isAdmin: true,
        reason: 'pay_later_approved',
        notes: `Ship before payment, approved by ${actor.name || (isAdmin(actor) ? 'the admin' : 'accounts')}: ${reason}`,
        payLater: { approvedAt: now, approvedBy: actor._id, approvedByName: actor.name || '', reason },
        session,
      });
      if (!result?.success) {
        throw fail(result?.conflict || /paid|transition/i.test(result?.message || '')
          ? 'This order was paid or changed just now. Reload it.'
          : (result?.message || 'Could not turn on ship before payment.'), 409);
      }
      // The old link is dead (cancelled above); the "on hold" note no longer applies.
      // Still B2B? Accounts may have changed it to B2C since we read it
      // (salesTypeService.changeSalesType). A change committed after this
      // transaction began conflicts with this write and the transaction is retried,
      // so the retry sees it and stops here.
      const still = await orderRepository.model.updateOne(
        { _id: order._id, 'buyer.type': order.buyer?.type, 'buyerTypeCheck.changeCount': order.buyerTypeCheck?.changeCount || { $in: [0, null] } },
        { $unset: { paymentLinkId: '', paymentLinkUrl: '', paymentLinkExpiresAt: '', salesHold: '' } },
        { session },
      );
      if (!still.matchedCount) throw fail('This order\'s B2B / B2C type was changed just now. Reload it.', 409);
    });
  } catch (err) {
    // Refused after the old link was cancelled: show it as expired (it is dead at
    // Razorpay), so the seller sends a new one instead of sharing a dead link.
    if (hadLiveLink) {
      await orderRepository.model.updateOne(
        { _id: order._id, status: 'awaiting_payment', paymentLinkId: order.paymentLinkId },
        { $set: { paymentLinkExpiresAt: new Date() } },
      ).catch(() => {});
    }
    throw err;
  } finally {
    await session.endSession();
  }

  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'pay_later_approved', amount: order.totalAmount, reason });
  enqueue('send-staff-pay-later-approved-alert', { orderId: String(order._id) });
  const fresh = await orderRepository.findById(order._id, [
    { path: 'user', select: 'name email phone' },
    { path: 'salesUser', select: 'name' },
  ]);
  return { order: shapeRow(fresh), alreadyApproved: false };
}

// ── 2b. Taking it back ──────────────────────────────────────────────────────────

/**
 * Admin / accounts: take "Ship before payment" back (owner 2026-11-26 — accounts
 * needs an edit option on what it approves). Only while it is unpaid and nothing
 * has left: then the order simply waits for payment again, and can be let ship
 * before payment again later (a new approval, with its own reason).
 *
 * Once a parcel has left it CANNOT be taken back — the goods are with the
 * customer; the payment link and the reminders are how the money is collected.
 *
 * Idempotent: a second click (nothing on any more) returns `alreadyOff`.
 */
export async function withdrawPayLater(actor, orderId, input = {}, req) {
  if (!mayApprove(actor)) throw fail('Only the admin or accounts can take back ship before payment.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < PAY_LATER.REASON_MIN) throw fail('Write why it is being taken back.', 400);
  if (reason.length > PAY_LATER.REASON_MAX) throw fail(`Keep the reason under ${PAY_LATER.REASON_MAX} characters.`, 400);

  const order = await orderRepository.model.findById(orderId)
    .select('status paymentStatus payLater shipments.status statusHistory.reason statusHistory.timestamp statusHistory.notes').lean();
  if (!order) throw fail('Order not found.', 404);
  if (!order.payLater?.approvedAt) return { alreadyOff: true, withdrawn: lastWithdrawalOf(order) };
  if (order.paymentStatus === 'paid') throw fail('This order is already paid — there is nothing to take back.', 409);
  if (payLaterHasLeft(order)) {
    throw fail('Part of this order has already been sent, so this cannot be taken back. The customer still has to pay the link they were sent.', 409);
  }

  const now = new Date();
  const who = actor.name || (isAdmin(actor) ? 'the admin' : 'accounts');
  const updated = await orderRepository.model.findOneAndUpdate(
    { _id: order._id, ...payLaterWithdrawFilter() },
    payLaterWithdrawUpdate({ actor, at: now, previous: order.payLater, notes: `Ship before payment taken back by ${who}: ${reason}` }),
    { new: true },
  ).lean();
  if (!updated) throw fail('This order was paid or sent just now. Reload it.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'pay_later_withdrawn', reason, approvedAt: order.payLater.approvedAt });
  enqueue('send-staff-pay-later-withdrawn-alert', { orderId: String(order._id) });
  return { alreadyOff: false, withdrawn: lastWithdrawalOf(updated) };
}

// ── 3. After dispatch ──────────────────────────────────────────────────────────

/**
 * A parcel left. Starts the due date (once) and sends the payment link.
 * Called by shipmentService for EVERY dispatched parcel; a no-op for ordinary
 * orders (one indexed read). Never throws: the hourly sweep retries.
 */
const inFlight = new Set();
/** Resolves once every after-dispatch call started so far has finished (tests, graceful shutdown). */
export const whenIdle = () => Promise.allSettled([...inFlight]);

export function afterDispatch(orderId, now = new Date()) {
  const run = runAfterDispatch(orderId, now);
  inFlight.add(run);
  run.finally(() => inFlight.delete(run));
  return run;
}

async function runAfterDispatch(orderId, now) {
  try {
    await orderRepository.model.updateOne(
      { _id: orderId, ...payLaterDueFilter(), 'payLater.dispatchedAt': { $exists: false } },
      { $set: { 'payLater.dispatchedAt': now, 'payLater.dueAt': dueAtFor(now) } },
    );
    return await sendLinkIfDue(orderId, now);
  } catch (err) {
    console.error(`[PayLater] after dispatch, order ${orderId}:`, err.message);
    Sentry.captureException(err, { extra: { orderId: String(orderId) } });
    return { sent: false, error: err.message };
  }
}

/**
 * Send the after-dispatch payment link, once. Claim → create at Razorpay → save if
 * still unpaid (else cancel the new link). A crash between claim and save leaves a
 * claim that goes stale after LINK_CLAIM_STALE_MS, and the sweep tries again.
 */
export async function sendLinkIfDue(orderId, now = new Date()) {
  const staleBefore = new Date(now.getTime() - PAY_LATER.LINK_CLAIM_STALE_MS);
  const claimed = await orderRepository.model.findOneAndUpdate(
    {
      _id: orderId,
      ...payLaterDueFilter(),
      'payLater.dispatchedAt': { $type: 'date' },
      'payLater.linkSentAt': { $exists: false },
      'payLater.linkBlocked': { $exists: false },
      bankTransferPendingAt: null,
      $or: [{ 'payLater.linkClaimedAt': { $exists: false } }, { 'payLater.linkClaimedAt': { $lt: staleBefore } }],
    },
    { $set: { 'payLater.linkClaimedAt': now } },
    { new: true },
  ).populate({ path: 'user', select: 'name email phone' });
  if (!claimed) return { sent: false };
  const release = (set = {}) => orderRepository.model.updateOne(
    { _id: claimed._id, 'payLater.linkClaimedAt': now },
    { $unset: { 'payLater.linkClaimedAt': '' }, ...(Object.keys(set).length ? { $set: set } : {}) },
  );

  // Part of the order was cancelled: what the customer owes is no longer the order
  // total, and a link for the total would overcharge them. The admin settles it.
  if ((claimed.cancellations || []).length) {
    await release({ 'payLater.linkBlocked': 'part_cancelled' });
    return { sent: false, blocked: 'part_cancelled' };
  }

  const attempt = (claimed.paymentLinkAttempts || 1) + 1;
  let link;
  try {
    link = await razorpayService.createPaymentLink(claimed, {
      name: claimed.shippingAddress?.fullName || claimed.user?.name,
      email: publicEmail(claimed.user?.email || claimed.guestEmail) || undefined,
      phone: claimed.shippingAddress?.phone || claimed.user?.phone,
    }, { attempt, ttlSeconds: PAY_LATER.LINK_TTL_DAYS * DAY_SECONDS });
  } catch (err) {
    await release();
    throw err;
  }

  const saved = await orderRepository.model.findOneAndUpdate(
    { _id: claimed._id, ...payLaterDueFilter(), 'payLater.linkClaimedAt': now },
    {
      $set: {
        paymentLinkId: link.id,
        paymentLinkUrl: link.shortUrl,
        paymentLinkExpiresAt: new Date(now.getTime() + PAY_LATER.LINK_TTL_DAYS * DAY_SECONDS * 1000),
        paymentLinkAttempts: attempt,
        'payLater.linkSentAt': now,
      },
      $unset: { 'payLater.linkClaimedAt': '' },
    },
    { new: true },
  );
  if (!saved) {
    // Paid (or the claim was taken over) while the link was being made: this one must not be payable.
    await razorpayService.cancelPaymentLink(link.id).catch(() => {});
    return { sent: false };
  }
  return { sent: true, linkId: link.id };
}

// ── 5. Hourly sweep ────────────────────────────────────────────────────────────

/**
 * Anything the webhook did not settle. Captures on the current link are applied
 * through the same idempotent routine the webhook uses, so a missed webhook still
 * ends in exactly one payment.
 */
async function recoverCaptures(order, now) {
  if (!order.paymentLinkId || !order.payLater?.linkSentAt) return false;
  if (now.getTime() - new Date(order.payLater.linkSentAt).getTime() < MIN_LINK_AGE_MS) return false;
  const { payments } = await razorpayService.fetchPaymentLinkCaptures(order.paymentLinkId);
  const captured = payments[0];
  if (!captured) return false;
  const { alreadyProcessed, gatewayOffer } = await razorpayService._validatePaymentAgainstOrder(order, captured);
  if (!alreadyProcessed) {
    await razorpayService.processPaymentSuccess(String(order._id), captured, order.user ? idOf(order.user) : undefined, { gatewayOffer });
    console.warn(`[PayLater] Recovered a payment the webhook missed | order ${order._id}`);
  }
  return true;
}

/** Remind the customer about their live link (Razorpay sends it). */
async function remindCustomer(order) {
  const email = publicEmail(order.user?.email || order.guestEmail);
  const phone = order.shippingAddress?.phone || order.user?.phone;
  const sends = [];
  if (phone) sends.push(razorpayService.notifyPaymentLink(order.paymentLinkId, 'sms'));
  if (email) sends.push(razorpayService.notifyPaymentLink(order.paymentLinkId, 'email'));
  const results = await Promise.allSettled(sends);
  return results.some((r) => r.status === 'fulfilled');
}

export async function sweepPayLater({ now = new Date() } = {}) {
  const today = istDayKey(now);
  const stats = { checked: 0, recovered: 0, dispatched: 0, linksSent: 0, reminded: 0, overdue: 0, failed: 0 };
  const overdueIds = [];
  const orders = await orderRepository.model.find(payLaterDueFilter())
    .select('_id wpId user guestEmail status paymentStatus totalAmount shippingAddress shipments statusHistory updatedAt '
      + 'payLater paymentLinkId paymentLinkUrl paymentLinkExpiresAt paymentLinkAttempts bankTransferPendingAt cancellations')
    .populate({ path: 'user', select: 'name email phone' })
    .sort({ 'payLater.approvedAt': 1, _id: 1 })
    .limit(SWEEP_LIMIT);

  for (const order of orders) {
    stats.checked += 1;
    try {
      if (await recoverCaptures(order, now)) { stats.recovered += 1; continue; }

      // Shipped some other way (status menu, bulk): start the clock from the parcel.
      if (!order.payLater.dispatchedAt) {
        const at = dispatchedAtOf(order);
        if (!at) continue; // not sent yet: nothing is due
        const r = await orderRepository.model.updateOne(
          { _id: order._id, 'payLater.dispatchedAt': { $exists: false } },
          { $set: { 'payLater.dispatchedAt': at, 'payLater.dueAt': dueAtFor(at) } },
        );
        if (r.modifiedCount) stats.dispatched += 1;
        order.payLater.dispatchedAt = at;
        order.payLater.dueAt = dueAtFor(at);
      }

      // The link ran out: it is dead at Razorpay (captures were checked above), so
      // free the order for a fresh one.
      const expired = order.payLater.linkSentAt && order.paymentLinkExpiresAt
        && new Date(order.paymentLinkExpiresAt).getTime() <= now.getTime();
      if (expired) {
        await orderRepository.model.updateOne(
          { _id: order._id, paymentLinkId: order.paymentLinkId, 'payLater.linkSentAt': order.payLater.linkSentAt },
          { $unset: { 'payLater.linkSentAt': '' } },
        );
      }
      const sent = await sendLinkIfDue(order._id, now);
      if (sent.sent) stats.linksSent += 1;

      if (new Date(order.payLater.dueAt).getTime() > now.getTime()) continue;
      // Nobody is texted at night: chasing waits for Indian working hours.
      if (!inChaseHours(now)) continue;

      // Overdue: once per IST day — remind the customer, list it in the alert.
      const claimed = await orderRepository.model.findOneAndUpdate(
        { _id: order._id, ...payLaterDueFilter(), 'payLater.lastChasedOn': { $ne: today } },
        { $set: { 'payLater.lastChasedOn': today }, $inc: { 'payLater.chaseCount': 1 } },
        { new: true },
      ).populate({ path: 'user', select: 'name email phone' });
      if (!claimed) continue;
      stats.overdue += 1;
      overdueIds.push(String(order._id));
      // A link sent just now already reached them; a transfer being checked needs no reminder.
      const live = claimed.paymentLinkId && claimed.paymentLinkExpiresAt
        && new Date(claimed.paymentLinkExpiresAt).getTime() > now.getTime();
      if (live && !sent.sent && !claimed.bankTransferPendingAt && await remindCustomer(claimed)) stats.reminded += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`[PayLater] sweep, order ${order._id}:`, err.message);
      Sentry.captureException(err, { extra: { orderId: String(order._id) } });
    }
  }

  if (overdueIds.length) enqueue('send-pay-later-overdue-alert', { orderIds: overdueIds });
  return stats;
}

// ── Lists and counts ───────────────────────────────────────────────────────────

/** The bell: shipped-and-unpaid orders past their due date (admin + accounts). */
export async function countOverdue(now = new Date()) {
  return orderRepository.model.countDocuments({ ...payLaterDueFilter(), 'payLater.dueAt': { $lt: now } });
}

const LIST_SELECT = 'orderNumber wpId createdAt paidAt status paymentStatus totalAmount shippingAddress user salesUser guestEmail '
  + 'payLater paymentLinkUrl paymentLinkExpiresAt bankTransferPendingAt';

function shapeRow(o, now = new Date()) {
  return {
    id: String(o._id),
    orderNumber: orderNumber(o),
    status: o.status,
    paymentStatus: o.paymentStatus,
    amount: o.totalAmount,
    paidAt: o.paidAt || null,
    customer: {
      name: o.user?.name || o.shippingAddress?.fullName || '',
      phone: o.shippingAddress?.phone || o.user?.phone || '',
      city: o.shippingAddress?.city || '',
    },
    salesPerson: o.salesUser?.name || '',
    bankTransferPending: !!o.bankTransferPendingAt,
    payLater: shapePayLater(o, now),
  };
}

const VIEWS = Object.freeze({
  due: () => payLaterDueFilter(),
  paid: () => ({ 'payLater.approvedAt': { $type: 'date' }, paymentStatus: { $in: ['paid', 'refunded'] } }),
});

const mayList = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS) || isSalesHead(u);

const encodeCursor = (o) => Buffer.from(`${new Date(o.payLater.approvedAt).toISOString()}|${o._id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !mongoose.isValidObjectId(id)) return null;
    return { at, id: new mongoose.Types.ObjectId(id) };
  } catch {
    return null;
  }
}

/**
 * "Shipped – payment due" (view=due) or "Paid after dispatch" (view=paid), newest
 * approval first, keyset-paged on the order_pay_later index. The due view also
 * carries the server's total owed — the screens never add money up themselves.
 */
export async function listPayLater(actor, { cursor, view = 'due' } = {}) {
  if (!mayList(actor)) throw fail('Not authorized.', 403);
  const base = (VIEWS[view] || VIEWS.due)();
  const after = decodeCursor(cursor);
  const query = after
    ? { $and: [base, { $or: [{ 'payLater.approvedAt': { $lt: after.at } }, { 'payLater.approvedAt': after.at, _id: { $lt: after.id } }] }] }
    : base;
  const rows = await orderRepository.model.find(query)
    .select(LIST_SELECT)
    .populate({ path: 'user', select: 'name email phone' })
    .populate({ path: 'salesUser', select: 'name' })
    .sort({ 'payLater.approvedAt': -1, _id: -1 })
    .limit(PAGE_SIZE + 1);
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const now = new Date();
  const out = {
    orders: page.map((o) => shapeRow(o, now)),
    nextCursor: more ? encodeCursor(page[page.length - 1]) : null,
  };
  if (!after && (view || 'due') === 'due') {
    const { paise: owed, count } = await outstandingPaise();
    out.summary = {
      owed: owed / 100,
      count,
      overdue: await countOverdue(now),
      dueDays: PAY_LATER.DUE_DAYS,
    };
  }
  // Accounts / admin may take back one that has not been sent yet (withdrawPayLater).
  out.canWithdraw = mayApprove(actor);
  return out;
}

/**
 * Can the admin turn it on for this order — and if not, why. For the order page,
 * so the button is never offered on an order the server would refuse anyway.
 */
export async function payLaterOptionFor(actor, orderId) {
  if (!mayApprove(actor)) throw fail('Not authorized.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const order = await orderRepository.findById(orderId);
  if (!order) throw fail('Order not found.', 404);
  const now = new Date();
  // B2B / B2C badge + accounts' check, shown on the order page whatever else applies.
  const base = {
    dueDays: PAY_LATER.DUE_DAYS,
    salesType: order.salesUser ? shapeSalesType(order) : null,
    // The "Change to B2B / B2C" button on the order page (salesTypeService).
    typeChange: order.salesUser && order.buyerTypeCheck?.status ? typeChangeOption(order) : null,
  };
  // The latest take-back, shown on the order page so nobody wonders where it went.
  base.withdrawn = lastWithdrawalOf(order);
  if (order.payLater?.approvedAt) {
    const populated = await orderRepository.findById(order._id, [{ path: 'user', select: 'name email phone' }, { path: 'salesUser', select: 'name' }]);
    const canWithdraw = order.paymentStatus !== 'paid' && !payLaterHasLeft(order);
    return { ...base, canApprove: false, canWithdraw, approved: shapeRow(populated, now) };
  }
  const no = (why) => ({ ...base, canApprove: false, why });
  if (!order.salesUser) return no('Only for orders made in the sales panel.');
  if (order.status !== 'awaiting_payment' || !UNPAID_PAYMENT_STATUSES.includes(order.paymentStatus)) return { ...base, canApprove: false, why: null };
  const typeProblem = payLaterTypeProblem(order);
  if (typeProblem) return no(typeProblem);
  if (order.bankTransferPendingAt) return no('A bank transfer is waiting for accounts.');
  if ((order.paymentParts || []).length) return no('This order is paid in parts.');
  const overdue = await findOverdueFor(order.user, now);
  if (overdue) return no(`The customer has not paid overdue order ${orderNumber(overdue)}.`);
  const { paise: owed } = await outstandingPaise();
  return { ...base, canApprove: true, owed: owed / 100 };
}
