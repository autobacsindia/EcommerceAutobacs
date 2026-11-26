/**
 * Accounts' check of a GTM order's B2B / B2C type — owner, 2026-11-25.
 *
 * GTM marks a quotation B2B or B2C (utils/salesType.js). When the customer accepts,
 * the order is created with `buyerTypeCheck.status = 'pending'`. Accounts (or the
 * admin) looks at the type and its reason ("B2C — offer applied: 10% off (Black
 * Friday)", "B2B — no offers") and approves it with a note. A B2B order can ship
 * before payment only after this (services/payLaterService.js).
 *
 * Approving changes nothing about money or order state; it is a once-only
 * compare-and-set on `pending`, so two clicks record one approval.
 *
 * CHANGING the type later (owner 2026-11-26: "she need an edit option") is
 * changeSalesType below: a reason is required, every change is kept in
 * `buyerTypeCheck.changes` (who, when, from → to, why, the replaced buyer block),
 * and the money stays exactly as sold. See its comment for the rules.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import {
  shapeSalesType, isB2B, salesTypeOf, typeChangeProblem, payLaterEffectOf,
  TYPE_CHANGE_REASON_MIN, TYPE_CHANGE_REASON_MAX, SALES_TYPES,
} from '../utils/salesType.js';
import { shapePayLater, payLaterWithdrawFilter, payLaterWithdrawUpdate, mergeUpdates } from '../utils/payLater.js';
import { resolveBuyer } from './buyerService.js';
import { BUYER_TYPES } from '../config/buyer.js';
import { enqueueNotification } from '../queue/queues.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;

/** Who may approve the type: accounts and the admin. */
export const mayCheck = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
/** Who may see the list: they, and the GTM head (read-only). */
const mayList = (u) => mayCheck(u) || isSalesHead(u);

export const NOTE_MIN = 3;
export const NOTE_MAX = 300;
const PAGE_SIZE = 25;

/**
 * The two lists on the accounts screen, newest order first:
 *   check      → GTM orders waiting for accounts to approve their type
 *   b2b_unpaid → approved B2B orders not paid yet, that have not been let ship —
 *                where accounts / the admin can turn on "Ship before payment"
 *   approved   → every GTM order whose type is approved — where accounts finds an
 *                order to change B2B ↔ B2C (same index: status + createdAt)
 */
export const SALES_TYPE_VIEWS = Object.freeze({
  check: () => ({ 'buyerTypeCheck.status': 'pending', status: { $ne: 'cancelled' } }),
  b2b_unpaid: () => ({
    'buyerTypeCheck.status': 'approved',
    'buyer.type': 'enterprise',
    status: 'awaiting_payment',
    paymentStatus: { $in: ['pending', 'failed'] },
    'payLater.approvedAt': { $exists: false },
  }),
  approved: () => ({ 'buyerTypeCheck.status': 'approved' }),
});

const LIST_SELECT = 'orderNumber wpId createdAt status paymentStatus totalAmount subtotal shippingAddress user salesUser '
  + 'buyer buyerTypeCheck salesDiscount items.name items.price items.listPrice items.custom items.quantity payLater bankTransferPendingAt '
  + 'invoiceNo shipments.status';

/** Can this order be switched to the other type now — and if not, why (for the button). */
export function typeChangeOption(o) {
  const to = isB2B(o) ? SALES_TYPES.B2C : SALES_TYPES.B2B;
  const why = typeChangeProblem(o, to);
  return {
    to,
    toLabel: to === SALES_TYPES.B2B ? 'B2B' : 'B2C',
    allowed: !why,
    why,
    // What switching to B2C would do to "Ship before payment", said before the click.
    payLaterEffect: to === SALES_TYPES.B2C ? payLaterEffectOf(o) : 'none',
  };
}

function shapeRow(o) {
  return {
    id: String(o._id),
    orderNumber: orderNumber(o),
    createdAt: o.createdAt,
    status: o.status,
    paymentStatus: o.paymentStatus,
    amount: o.totalAmount,
    customer: {
      name: o.user?.name || o.shippingAddress?.fullName || '',
      phone: o.shippingAddress?.phone || o.user?.phone || '',
      city: o.shippingAddress?.city || '',
    },
    salesPerson: o.salesUser?.name || '',
    bankTransferPending: !!o.bankTransferPendingAt,
    salesType: shapeSalesType(o),
    typeChange: o.buyerTypeCheck?.status ? typeChangeOption(o) : null,
    payLater: shapePayLater(o),
  };
}

const encodeCursor = (o) => Buffer.from(`${new Date(o.createdAt).toISOString()}|${o._id}`).toString('base64url');
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

/** One page of a list (keyset on createdAt, _id). */
export async function listSalesTypeChecks(actor, { cursor, view = 'check' } = {}) {
  if (!mayList(actor)) throw fail('Not authorized.', 403);
  const base = (SALES_TYPE_VIEWS[view] || SALES_TYPE_VIEWS.check)();
  const after = decodeCursor(cursor);
  const query = after
    ? { $and: [base, { $or: [{ createdAt: { $lt: after.at } }, { createdAt: after.at, _id: { $lt: after.id } }] }] }
    : base;
  const rows = await orderRepository.model.find(query)
    .select(LIST_SELECT)
    .populate({ path: 'user', select: 'name phone' })
    .populate({ path: 'salesUser', select: 'name' })
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .lean();
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    orders: page.map(shapeRow),
    nextCursor: more ? encodeCursor(page[page.length - 1]) : null,
    canCheck: mayCheck(actor),
  };
}

/** Approve the order's B2B / B2C type, with a note. Once only. */
export async function approveSalesType(actor, orderId, input = {}, req) {
  if (!mayCheck(actor)) throw fail('Only accounts or the admin can approve B2B / B2C.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length < NOTE_MIN) throw fail('Write a short note with your approval.', 400);
  if (note.length > NOTE_MAX) throw fail(`Keep the note under ${NOTE_MAX} characters.`, 400);

  const order = await orderRepository.model.findById(orderId).select('buyer buyerTypeCheck status').lean();
  if (!order) throw fail('Order not found.', 404);
  if (!order.buyerTypeCheck?.status) throw fail('This order has no B2B / B2C check.', 409);
  if (order.buyerTypeCheck.status === 'approved') throw fail('Already approved.', 409);
  if (order.status === 'cancelled') throw fail('This order is cancelled.', 409);

  const type = isB2B(order) ? 'b2b' : 'b2c';
  const check = {
    status: 'approved',
    type,
    by: actor._id,
    byName: actor.name || '',
    role: isAdmin(actor) ? 'admin' : 'accounts',
    at: new Date(),
    note,
  };
  // Compare-and-set on `pending` AND on the type it was asked about: a second
  // click, or a type that changed meanwhile, changes nothing.
  const updated = await orderRepository.model.findOneAndUpdate(
    { _id: order._id, 'buyerTypeCheck.status': 'pending', 'buyer.type': order.buyer?.type ?? null, status: { $ne: 'cancelled' } },
    { $set: { buyerTypeCheck: check } },
    { new: true },
  ).populate({ path: 'user', select: 'name phone' }).populate({ path: 'salesUser', select: 'name' }).lean();
  if (!updated) throw fail('This order changed just now. Reload it.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, { change: 'sales_type_approved', type, note });
  return { order: shapeRow(updated) };
}

const POPULATE = [{ path: 'user', select: 'name phone' }, { path: 'salesUser', select: 'name' }];

/**
 * Accounts / the admin: change an order B2B ↔ B2C, with a reason.
 *
 * Choices (owner 2026-11-26), each also stated in the PR:
 *   • The type is `buyer.type`, so the buyer block is what changes. B2C → B2B needs
 *     the company name + a checksum-valid GSTIN + billing address (buyerService), as
 *     on a quotation. B2B → B2C drops them (a consumer receipt carries no GSTIN).
 *     The replaced block is kept in the history entry.
 *   • Money is never touched. B2C → B2B is refused when the order was sold with
 *     offers (B2B gets none) — make a new quotation instead of repricing.
 *   • Refused once the receipt was emailed (`invoiceNo` set): the customer's copy
 *     prints the company/GSTIN, and our record must not disagree with it.
 *   • "Ship before payment" when going to B2C:
 *       - on, unpaid, nothing has left → taken back in the SAME write: the order
 *         returns to awaiting_payment and payLater is removed, so shipping is refused
 *         until it is paid (shipmentService checks paid or isPayLaterDue). The team
 *         workflow is kept, so it carries on once paid. Teams + admin are emailed.
 *       - on, unpaid, already shipped → left running (the customer still owes; the
 *         link and reminders continue). The admin is emailed and the order shows red.
 *   • The legal-acceptance record is NOT touched: it records what was accepted.
 *   • Same type asked again (a double click) → `unchanged`, no second entry.
 *   • One atomic compare-and-set on type + change count + status + payment + the
 *     pay-later state read: anything that moved meanwhile → 409 "reload".
 *   • Changing a pending order also approves it (the change is accounts' decision).
 */
export async function changeSalesType(actor, orderId, input = {}, req) {
  if (!mayCheck(actor)) throw fail('Only accounts or the admin can change B2B / B2C.', 403);
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  const to = String(input.to ?? '').trim().toLowerCase();
  if (to !== SALES_TYPES.B2B && to !== SALES_TYPES.B2C) throw fail('Choose B2B or B2C.', 400);
  const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < TYPE_CHANGE_REASON_MIN) throw fail('Write why the type is changing.', 400);
  if (reason.length > TYPE_CHANGE_REASON_MAX) throw fail(`Keep the reason under ${TYPE_CHANGE_REASON_MAX} characters.`, 400);

  const order = await orderRepository.model.findById(orderId)
    .select('buyer buyerTypeCheck status paymentStatus invoiceNo salesDiscount items.price items.listPrice items.custom payLater shipments.status')
    .lean();
  if (!order) throw fail('Order not found.', 404);
  const from = salesTypeOf(order);
  if (!order.buyerTypeCheck?.status) throw fail(typeChangeProblem(order, to), 409);
  if (from === to) {
    const same = await orderRepository.model.findById(order._id).select(LIST_SELECT).populate(POPULATE).lean();
    return { order: shapeRow(same), unchanged: true };
  }
  const problem = typeChangeProblem(order, to);
  if (problem) throw fail(problem, 409);

  // Validated exactly as on a quotation; throws a 400 the user can read.
  const buyer = to === SALES_TYPES.B2B
    ? resolveBuyer({ ...(input.buyer || {}), type: BUYER_TYPES.ENTERPRISE })
    : { type: BUYER_TYPES.INDIVIDUAL };

  const effect = to === SALES_TYPES.B2C ? payLaterEffectOf(order) : 'none';
  const now = new Date();
  const role = isAdmin(actor) ? 'admin' : 'accounts';
  const count = order.buyerTypeCheck.changeCount || 0;
  const entry = {
    at: now, by: actor._id, byName: actor.name || '', role, from, to, reason,
    previousBuyer: order.buyer ?? null, payLaterEffect: effect,
  };

  const filter = {
    _id: order._id,
    'buyer.type': order.buyer?.type ?? null,
    'buyerTypeCheck.status': order.buyerTypeCheck.status,
    'buyerTypeCheck.changeCount': count ? count : { $in: [0, null] },
    invoiceNo: null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    'payLater.approvedAt': order.payLater?.approvedAt ? { $type: 'date' } : { $exists: false },
  };
  const $set = {
    buyer,
    'buyerTypeCheck.status': 'approved',
    'buyerTypeCheck.type': to,
    'buyerTypeCheck.changeCount': count + 1,
  };
  if (order.buyerTypeCheck.status !== 'approved') {
    Object.assign($set, {
      'buyerTypeCheck.by': actor._id, 'buyerTypeCheck.byName': actor.name || '',
      'buyerTypeCheck.role': role, 'buyerTypeCheck.at': now, 'buyerTypeCheck.note': reason,
    });
  }
  const update = { $set, $push: { 'buyerTypeCheck.changes': entry } };

  let finalUpdate = update;
  if (effect === 'withdrawn') {
    // Same filter and write as "Take back ship before payment" (utils/payLater.js).
    Object.assign(filter, payLaterWithdrawFilter());
    finalUpdate = mergeUpdates(update, payLaterWithdrawUpdate({
      actor, at: now, previous: order.payLater,
      notes: `Changed to B2C by ${actor.name || role}: ship before payment taken back. Reason: ${reason}`,
    }));
  }

  const updated = await orderRepository.model.findOneAndUpdate(filter, finalUpdate, { new: true })
    .select(LIST_SELECT).populate(POPULATE).lean();
  if (!updated) throw fail('This order changed just now. Reload it.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', order._id, {
    change: 'sales_type_changed', from, to, reason, payLaterEffect: effect,
  });
  if (effect !== 'none') {
    Promise.resolve()
      .then(() => enqueueNotification('send-staff-sales-type-changed-alert', { orderId: String(order._id) }))
      .catch(() => {});
  }
  return { order: shapeRow(updated), unchanged: false, payLaterEffect: effect };
}

export default { listSalesTypeChecks, approveSalesType, changeSalesType, mayCheck };
