/**
 * Crediting a website order to the salesman who closed it.
 *
 * A GTM lead talks a customer through the sale, and the customer then pays on the
 * website themselves. The order arrives as a plain website order (no `salesUser`),
 * so it is missing from that salesman's orders and reports. Admin and marketing
 * fix that here.
 *
 * What this may change: `salesUser` and nothing else. Never price, payment or
 * status. Hence the limits:
 *   - website orders only (`source: 'web'`). Staff-made orders already carry their
 *     seller, and changing that is a different conversation.
 *   - paid orders only. An unpaid order still has live payment machinery keyed on
 *     `salesUser` (payment-link reconciliation in paymentReconciliationService),
 *     and the money truth for a paid order is already settled by the webhook.
 *   - compare-and-set on the seller the person SAW, so two people at once (or a
 *     stale screen) cannot silently overwrite each other.
 * Every change is kept on the order (`salesAttribution`) and in the audit log.
 */

import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { orderNumber } from './invoiceService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;
/** How much history one order keeps. Reassigning is rare; this is a ceiling, not a target. */
const HISTORY_KEEP = 50;

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isMarketing = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.MARKETING;

/** Admin and marketing credit website orders. */
export const mayAttribute = (u) => isAdmin(u) || isMarketing(u);

function assertMay(actor) {
  if (!mayAttribute(actor)) throw fail('Only admin and marketing can credit a website order to a salesman.', 403);
}

// ── Cursor (keyset on createdAt desc, _id desc) ─────────────────────────────
const encodeCursor = (o) => Buffer.from(`${new Date(o.createdAt).toISOString()}|${o._id}`).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(id || '')) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Who a website order can be credited to: the GTM head and GTM leads — the people who sell. */
export async function listSellers(actor) {
  assertMay(actor);
  const team = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
  return team.filter(canSell).map((u) => ({ id: idOf(u._id), name: u.name || '', isHead: u.staff?.isHead === true }));
}

/**
 * Only what is needed to recognise the order — no phone, email or address lines
 * (marketing has no other reason to hold them).
 */
const shapeRow = (o) => ({
  id: idOf(o._id),
  orderNumber: orderNumber(o),
  createdAt: o.createdAt,
  totalAmount: o.totalAmount,
  status: o.status,
  customer: o.shippingAddress?.fullName || o.user?.name || '',
  city: [o.shippingAddress?.city, o.shippingAddress?.state].filter(Boolean).join(', '),
  items: (o.items || []).map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`),
  seller: o.salesUser ? { id: idOf(o.salesUser), name: o.salesUser.name || '' } : null,
  history: (o.salesAttribution || []).slice().reverse().map((h) => ({
    at: h.at, by: h.byName || '', from: h.fromName || null, to: h.toName || null, note: h.note || '',
  })),
});

/**
 * Paid website orders, newest first, credited or not (so a wrong credit can be
 * fixed). Rides the `team_workflow_paid` partial index: every paid order enters
 * the team workflow the moment its payment confirms (orderStatusService).
 */
export async function listWebsiteOrders(actor, { cursor } = {}) {
  assertMay(actor);
  const base = { paymentStatus: 'paid', 'workflow.enteredAt': { $type: 'date' }, source: 'web' };
  const c = decodeCursor(cursor);
  const query = c
    ? { $and: [base, { $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c.id } }] }] }
    : base;
  const rows = await orderRepository.find(query, {
    limit: PAGE_SIZE + 1,
    sort: { createdAt: -1, _id: -1 },
    select: ROW_SELECT,
    populate: ROW_POPULATE,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { orders: items.map(shapeRow), nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

const ROW_SELECT = 'orderNumber wpId createdAt totalAmount status paymentStatus source items.name items.quantity '
  + 'shippingAddress.fullName shippingAddress.city shippingAddress.state user salesUser salesAttribution';
const ROW_POPULATE = [{ path: 'user', select: 'name' }, { path: 'salesUser', select: 'name' }];

/**
 * One order, for the box on the order page. `null` when it is not a paid website
 * order — the box then simply does not show (no error for the many orders that
 * are not eligible).
 */
export async function getWebsiteOrder(actor, orderId) {
  assertMay(actor);
  const [o] = await orderRepository.find({ _id: orderId }, { limit: 1, select: ROW_SELECT, populate: ROW_POPULATE });
  if (!o || o.source !== 'web' || o.paymentStatus !== 'paid') return null;
  return shapeRow(o);
}

/**
 * Credit (or un-credit, `salesUserId: null`) a paid website order.
 * @param {{ salesUserId: string|null, expectedSalesUserId: string|null, note?: string }} input
 *   `expectedSalesUserId` — the seller the person saw on screen (null = "no one").
 */
export async function setSeller(actor, orderId, { salesUserId = null, expectedSalesUserId = null, note } = {}, req) {
  assertMay(actor);
  const to = salesUserId ? String(salesUserId) : null;
  const expected = expectedSalesUserId ? String(expectedSalesUserId) : null;
  if (to === expected) throw fail('That salesman is already credited with this order.', 400);

  let seller = null;
  if (to) {
    seller = (await listSellers(actor)).find((s) => s.id === to);
    if (!seller) throw fail('Choose an active GTM head or GTM lead.', 400);
  }

  const order = await orderRepository.findById(orderId, [{ path: 'salesUser', select: 'name' }]);
  if (!order || order.source !== 'web') throw fail('Website order not found.', 404);
  if (order.paymentStatus !== 'paid') throw fail('Only a paid website order can be credited to a salesman.', 409);

  const entry = {
    at: new Date(),
    by: actor._id,
    byName: actor.name || '',
    from: expected,
    fromName: order.salesUser && idOf(order.salesUser) === expected ? order.salesUser.name || '' : '',
    to,
    toName: seller?.name || '',
    note: String(note || '').trim().slice(0, 300),
  };
  const updated = await orderRepository.model.findOneAndUpdate(
    { _id: order._id, source: 'web', paymentStatus: 'paid', salesUser: expected },
    {
      $set: { salesUser: to },
      $push: { salesAttribution: { $each: [entry], $slice: -HISTORY_KEEP } },
    },
    { new: true },
  ).populate(ROW_POPULATE).lean();
  if (!updated) throw fail('Someone else just changed this order. Refresh and try again.', 409);

  auditLogger.logAction(req, 'UPDATE', 'Order', idOf(order._id), {
    change: 'sales_attribution', from: expected, to, note: entry.note || undefined,
  });
  return shapeRow(updated);
}

export default { mayAttribute, listSellers, listWebsiteOrders, getWebsiteOrder, setSeller };
