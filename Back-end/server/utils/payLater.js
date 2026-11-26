/**
 * Pure helpers for "Ship before payment" (services/payLaterService.js).
 * No I/O here, so every rule below is unit-tested on its own.
 */
import { PAY_LATER, isPayLaterDue } from '../config/payLater.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Rupees → whole paise (money is compared in paise, never in floats). */
export const paise = (rupees) => Math.round(Number(rupees || 0) * 100);

/** The IST calendar day of `date`, as YYYY-MM-DD: "once a day" means once per Indian day. */
export const istDayKey = (date = new Date()) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** When the payment falls due: DUE_DAYS after the first parcel left. */
export const dueAtFor = (dispatchedAt) => new Date(new Date(dispatchedAt).getTime() + PAY_LATER.DUE_DAYS * DAY_MS);

/**
 * When the order was first sent out, from its parcels (the source of truth), or
 * null when nothing has left yet. An order marked shipped from the status menu
 * without a parcel counts from its `shipped` history entry.
 */
export function dispatchedAtOf(order) {
  const sent = (order?.shipments || [])
    .filter((s) => s.status === 'shipped' || s.status === 'delivered')
    .map((s) => new Date(s.shippedAt || s.createdAt || 0).getTime())
    .filter((t) => t > 0);
  if (sent.length) return new Date(Math.min(...sent));
  if (order?.status === 'shipped' || order?.status === 'delivered') {
    const h = (order.statusHistory || []).find((e) => e.status === 'shipped');
    return new Date(h?.timestamp || order.updatedAt || Date.now());
  }
  return null;
}

/** Whole days past the due date (0 while not yet due). */
export const overdueDays = (dueAt, now = new Date()) => {
  if (!dueAt) return 0;
  const late = new Date(now).getTime() - new Date(dueAt).getTime();
  return late > 0 ? Math.ceil(late / DAY_MS) : 0;
};

/** The words every screen shows for a pay-later order. */
export function payLaterLabel(order, now = new Date()) {
  if (!order?.payLater?.approvedAt) return '';
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return 'Paid after dispatch';
  if (!isPayLaterDue(order)) return 'Ship before payment — closed unpaid';
  if (!order.payLater.dispatchedAt) return 'Ship before payment — not sent yet';
  return overdueDays(order.payLater.dueAt, now) > 0 ? 'Shipped – payment overdue' : 'Shipped – payment due';
}

/** The pay-later block for a panel row, or null for an ordinary order. */
export function shapePayLater(order, now = new Date()) {
  const p = order?.payLater;
  if (!p?.approvedAt) return null;
  const live = !!order.paymentLinkUrl && !!order.paymentLinkExpiresAt
    && new Date(order.paymentLinkExpiresAt).getTime() > new Date(now).getTime();
  const due = isPayLaterDue(order);
  return {
    label: payLaterLabel(order, now),
    due,
    approvedAt: p.approvedAt,
    approvedBy: p.approvedByName || '',
    reason: p.reason || '',
    dispatchedAt: p.dispatchedAt || null,
    dueAt: p.dueAt || null,
    overdueDays: due ? overdueDays(p.dueAt, now) : 0,
    linkSentAt: p.linkSentAt || null,
    payUrl: due && live ? order.paymentLinkUrl : null,
    payUrlExpiresAt: due && live ? order.paymentLinkExpiresAt : null,
    // Why no link went out by itself — the admin follows it up.
    linkBlocked: due ? (p.linkBlocked || null) : null,
    reminders: p.chaseCount || 0,
  };
}

// ── Taking "Ship before payment" back (owner 2026-11-26) ─────────────────────────

/** Parcels that have left the building: after this nothing can be taken back. */
export const LEFT_SHIPMENT_STATUSES = Object.freeze(['shipped', 'delivered', 'lost']);

/** Has any part of this order left (or been marked shipped)? */
export const payLaterHasLeft = (order) => !!order?.payLater?.dispatchedAt
  || ['shipped', 'delivered'].includes(order?.status)
  || (order?.shipments || []).some((s) => LEFT_SHIPMENT_STATUSES.includes(s.status));

/**
 * The Mongo filter under which ship-before-payment may be taken back: on, still
 * unpaid, nothing has left. A parcel dispatched or a payment landing between the
 * read and the write fails it, so the take-back never half-happens.
 */
export const payLaterWithdrawFilter = () => ({
  status: 'processing',
  paymentStatus: { $in: ['pending', 'failed'] },
  'payLater.approvedAt': { $type: 'date' },
  'payLater.dispatchedAt': { $exists: false },
  shipments: { $not: { $elemMatch: { status: { $in: [...LEFT_SHIPMENT_STATUSES] } } } },
});

/**
 * The update that takes it back: the order waits for payment again and the
 * permission is removed. The team workflow is KEPT, so the work carries on once
 * it is paid (shipmentService refuses to ship it until then). The old permission
 * is kept in the history entry's metadata — nothing is lost.
 * Merge into a caller's update with mergeWithdraw().
 */
export function payLaterWithdrawUpdate({ actor, at, notes, previous }) {
  return {
    $set: { status: 'awaiting_payment' },
    $unset: { payLater: '' },
    $push: {
      statusHistory: {
        status: 'awaiting_payment',
        timestamp: at,
        updatedBy: actor?._id,
        reason: 'pay_later_withdrawn',
        notes,
        metadata: previous ? {
          payLater: {
            approvedAt: previous.approvedAt, approvedByName: previous.approvedByName || '', reason: previous.reason || '',
          },
        } : undefined,
      },
    },
    $inc: { __v: 1 },
  };
}

/** Merge two update documents operator by operator. */
export function mergeUpdates(a, b) {
  const out = { ...a };
  for (const [op, fields] of Object.entries(b)) out[op] = { ...(out[op] || {}), ...fields };
  return out;
}

/** The latest take-back on this order, for the order page — or null. */
export function lastWithdrawalOf(order) {
  const h = [...(order?.statusHistory || [])].reverse().find((e) => e.reason === 'pay_later_withdrawn');
  return h ? { at: h.timestamp || null, notes: h.notes || '' } : null;
}
