/**
 * Personal order pins — "keep this order at the top of my lists", like pinned
 * chats. Only the person who pinned an order sees it pinned; at most
 * MAX_ORDER_PINS each, newest pin first.
 *
 * A pin grants nothing: every list applies its own scope to pinned orders too
 * (pinnedRows / pinnedIds), so a pinned order shows only on lists that would
 * show it anyway, and only while it matches the list's filters.
 */

import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import orderPinRepository from '../repositories/orderPinRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { and } from '../utils/listQuery.js';

export const MAX_ORDER_PINS = 5;

const fail = (message, status) => new AppError(message, status, { expose: true });
const isStaffOrAdmin = (u) => u?.role === 'admin' || (u?.role === 'staff' && u.staff?.active === true);

function orderIdOf(orderId) {
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found.', 404);
  return new mongoose.Types.ObjectId(String(orderId));
}

/** This person's pinned order ids, newest pin first (never more than the cap). */
export async function pinnedIds(actor) {
  if (!actor?._id) return [];
  const pins = await orderPinRepository.findForUser(actor._id, MAX_ORDER_PINS);
  return pins.map((p) => p.order);
}

export async function pinOrder(actor, orderId) {
  if (!isStaffOrAdmin(actor)) throw fail('Not authorized.', 403);
  const id = orderIdOf(orderId);
  const [order] = await orderRepository.find({ _id: id }, { limit: 1, select: '_id' });
  if (!order) throw fail('Order not found.', 404);
  const ids = await pinnedIds(actor);
  if (ids.some((p) => String(p) === String(id))) return { pinned: true, pins: ids.map(String) };
  // Count, then insert: two pins in the same instant could make six; the lists
  // read only the newest five, so the worst case is one pin that does not show.
  if (await orderPinRepository.countForUser(actor._id) >= MAX_ORDER_PINS) {
    throw fail(`You can pin up to ${MAX_ORDER_PINS} orders. Unpin one first.`, 409);
  }
  await orderPinRepository.pin(actor._id, id);
  return { pinned: true, pins: (await pinnedIds(actor)).map(String) };
}

export async function unpinOrder(actor, orderId) {
  if (!isStaffOrAdmin(actor)) throw fail('Not authorized.', 403);
  const id = orderIdOf(orderId);
  await orderPinRepository.unpin(actor._id, id);
  return { pinned: false, pins: (await pinnedIds(actor)).map(String) };
}

export async function listPins(actor) {
  if (!isStaffOrAdmin(actor)) throw fail('Not authorized.', 403);
  return { pins: (await pinnedIds(actor)).map(String), max: MAX_ORDER_PINS };
}

/** The list query with pinned orders left out (they are listed on top instead). */
export function withoutPinned(query, ids) {
  if (!ids.length) return query;
  return and(query, { _id: { $nin: ids } });
}

/**
 * `rows` put in pin order (newest pin first), each marked `pinned: true`. Rows
 * whose order is not pinned (or that the list's own query did not return) drop out.
 */
export function inPinOrder(rows, ids) {
  const byId = new Map(rows.map((r) => [String(r._id ?? r.id), r]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}
