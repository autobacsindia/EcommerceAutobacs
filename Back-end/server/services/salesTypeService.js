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
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { shapeSalesType, isB2B } from '../utils/salesType.js';
import { shapePayLater } from '../utils/payLater.js';

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
});

const LIST_SELECT = 'orderNumber wpId createdAt status paymentStatus totalAmount subtotal shippingAddress user salesUser '
  + 'buyer buyerTypeCheck salesDiscount items.name items.price items.listPrice items.custom items.quantity payLater bankTransferPendingAt';

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

export default { listSalesTypeChecks, approveSalesType, mayCheck };
