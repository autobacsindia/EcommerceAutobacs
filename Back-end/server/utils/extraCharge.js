/**
 * Extra charges: the pure rules. No database, so every rule is directly testable.
 * Money is added in integer paise; rupees only at the edges.
 */
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { CLOSED_ORDER_STATUSES } from '../config/extraCharges.js';

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
export const isAdmin = (u) => u?.role === 'admin';
export const isSalesHead = (u) => onTeam(u, STAFF_TEAMS.SALES) && u.staff.isHead === true;
/** Accounts decides; the admin too. */
export const mayDecide = (u) => isAdmin(u) || onTeam(u, STAFF_TEAMS.ACCOUNTS);
export const seesAllExtras = (u) => mayDecide(u) || isSalesHead(u);
/** May read the extras on one order (GTM's own orders are checked by the caller). */
export const seesOrderExtras = (u) => seesAllExtras(u) || onTeam(u, STAFF_TEAMS.PROCUREMENT) || onTeam(u, STAFF_TEAMS.OPERATIONS);
/** The seller on this order, the GTM head, or the admin. */
export const sellsThisOrder = (u, salesUser) => isAdmin(u) || isSalesHead(u)
  || (canSell(u) && !!salesUser && idOf(salesUser) === idOf(u?._id));

export const isOrderClosed = (order) => CLOSED_ORDER_STATUSES.includes(order?.status);

const UNPAID = ['awaiting_accounts', 'approved'];
export const isUnpaid = (extra) => UNPAID.includes(extra?.status);

export function liveLink(extra, now = Date.now()) {
  return (extra?.links || []).find((l) => l.status === 'pending' && new Date(l.expiresAt).getTime() > now) || null;
}

/** Plain-English state, the same on every screen. */
export function statusLabel(extra, now = Date.now()) {
  const refund = extra?.refund?.status;
  if (refund === 'due') return 'Refund due';
  if (refund === 'processing') return 'Refund in progress';
  if (refund === 'completed') return 'Refunded';
  if (refund === 'failed') return 'Refund failed';
  switch (extra?.status) {
    case 'awaiting_accounts': return 'Waiting for Accounts';
    case 'rejected': return 'Rejected by Accounts';
    case 'cancelled': return 'Cancelled';
    case 'paid': return 'Paid';
    case 'approved':
      if (extra.bankTransferPendingAt) return 'Bank transfer waiting for Accounts';
      if (liveLink(extra, now)) return 'Payment link sent — waiting for customer';
      if ((extra.links || []).some((l) => l.status === 'pending' || l.status === 'expired')) return 'Payment link expired';
      return 'Approved — ask the customer to pay';
    default: return '';
  }
}

/** The money an extra still represents: paid and not refunded (a failed refund is still held). */
export function isKept(extra) {
  return extra?.status === 'paid' && (!extra.refund || extra.refund.status === 'failed');
}

/**
 * The server's sum for one order. `order.totalAmount` is the untouched original;
 * unpaid, rejected and cancelled extras add nothing.
 */
export function extraTotals(order, extras = []) {
  let paid = 0; let refunded = 0; let waiting = 0; let refundDue = 0;
  for (const e of extras) {
    const p = toPaise(e.amount);
    if (e.status === 'paid') {
      paid += p;
      if (e.refund?.status === 'completed') refunded += p;
      else if (e.refund) refundDue += p;
    } else if (e.status === 'approved') {
      waiting += p;
    }
  }
  const original = toPaise(order?.totalAmount || 0);
  return {
    original: original / 100,
    extrasPaid: paid / 100,
    extrasRefunded: refunded / 100,
    extrasRefundDue: refundDue / 100,
    extrasWaiting: waiting / 100,
    finalAmount: (original + paid) / 100,
  };
}

/** What a customer may see: no staff names or notes, and nothing before Accounts approved. */
export function customerView(extra, now = Date.now()) {
  const link = extra.status === 'approved' ? liveLink(extra, now) : null;
  return {
    id: idOf(extra._id),
    sequence: extra.sequence,
    amount: extra.amount,
    reason: extra.reason,
    status: extra.status,
    statusLabel: extra.status === 'approved' ? 'Waiting for your payment' : statusLabel(extra, now),
    payUrl: link?.url || null,
    payBy: link?.expiresAt || null,
    paidAt: extra.paidAt || null,
    hasReceipt: extra.status === 'paid',
    refundStatus: extra.refund?.status || null,
  };
}

/** Adds paid extras to a revenue-by-period series; a period with only extras gets a row with 0 orders. */
export function mergeRevenueSeries(series, extraBuckets = []) {
  const byBucket = new Map(series.map((row) => [new Date(row.bucket).getTime(), { ...row }]));
  for (const b of extraBuckets) {
    const key = new Date(b._id).getTime();
    const row = byBucket.get(key) || { bucket: b._id, revenue: 0, orders: 0, aov: 0 };
    row.revenue = (toPaise(row.revenue) + toPaise(b.total)) / 100;
    row.aov = row.orders > 0 ? Math.round((row.revenue / row.orders) * 100) / 100 : 0;
    byBucket.set(key, row);
  }
  return [...byBucket.values()].sort((a, b) => new Date(a.bucket) - new Date(b.bucket));
}

export const VISIBLE_TO_CUSTOMER = Object.freeze(['approved', 'paid']);
