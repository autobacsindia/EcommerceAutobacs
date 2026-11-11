/**
 * Admin Company overview — everything the company is doing, on one page.
 *
 * READ-ONLY, and built from records that already exist: orders and the team
 * workflow, payment requests, staff accounts, the audit log (every action a
 * staff member takes is logged there), consultations and support tickets. It
 * adds no tracking of its own.
 *
 * Every query is bounded and indexed; the whole page is a handful of small
 * reads run in parallel. The admin dashboard keeps the shop figures (revenue,
 * stock, customers); this is the team side.
 */
import AppError from '../utils/AppError.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import auditLogRepository from '../repositories/auditLogRepository.js';
import orderExtraChargeRepository from '../repositories/orderExtraChargeRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import supportTicketRepository from '../repositories/supportTicketRepository.js';
import { onlineAmong } from './chatPresence.js';
import { waitingBoard } from './teamActivityService.js';
import { STAFF_TEAM_LABELS, STAFF_TEAM_VALUES, staffRoleLabel } from '../config/staff.js';
import { istStartOfDay } from '../utils/datetime.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const DAY = 24 * 3600 * 1000;

/** Today's date in India as YYYY-MM-DD. */
const istToday = (now) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** What an audit entry means, in words — for the activity feed. */
export function describeAction(a) {
  const d = a.details || {};
  if (a.resource === 'Order') {
    switch (d.change) {
      case 'team_stock': return { text: `Marked an item ${String(d.stock || '').replace(/_/g, ' ')}`, area: 'Procurement' };
      case 'team_supplier_payment': return { text: d.initiated ? 'Marked supplier payment started' : 'Removed supplier payment mark', area: 'Procurement' };
      case 'team_shipped': return { text: 'Shipped a parcel (supplier proof uploaded)', area: 'Procurement' };
      case 'team_delivered': return { text: 'Marked a parcel delivered', area: 'Operations' };
      case 'team_customer_decision': return { text: d.decision === 'refund' ? 'Recorded: customer wants a refund' : 'Recorded: customer will wait', area: 'GTM' };
      case 'team_refund_approved': return { text: 'Approved an item refund', area: 'Accounts' };
      case 'team_refund_rejected': return { text: 'Sent a refund back to GTM', area: 'Accounts' };
      case 'team_payment_pending': return { text: `Item set to Payment Pending${d.ref ? ` (${d.ref})` : ''}`, area: 'Procurement' };
      case 'team_stock_undone': return { text: 'Undid a stock decision', area: 'Procurement' };
      case 'team_decision_undone': return { text: 'Undid a customer decision', area: 'GTM' };
      case 'team_dispatch_edited': return { text: 'Corrected dispatch details', area: 'Procurement' };
      default:
        if (a.action === 'CREATE' && d.via === 'sales_panel') return { text: `Created a sales order (₹${Number(d.totalAmount || 0).toLocaleString('en-IN')})`, area: 'GTM' };
        return { text: `${a.action === 'CREATE' ? 'Created' : 'Updated'} an order`, area: 'Orders' };
    }
  }
  if (a.resource === 'PaymentRequest') {
    if (a.action === 'CREATE') return { text: `Raised a ${d.kind === 'supplier' ? 'supplier payment' : 'expense'} (₹${Number(d.amount || 0).toLocaleString('en-IN')})`, area: 'Payments' };
    const words = { approved: 'Approved a payment', declined: 'Declined a payment', on_hold: 'Put a payment on hold', paid: 'Paid a payment', cancelled: 'Cancelled a payment request', edited: 'Edited a payment request' };
    return { text: words[d.change] || 'Updated a payment request', area: 'Payments' };
  }
  if (a.resource === 'User') {
    const words = {
      staff_company_account_created: 'Created a staff login', staff_password_reset: 'Changed a staff password',
      staff_access_removed: 'Removed a staff member\'s access', staff_access_granted: 'Joined a team',
      staff_password_changed: 'Changed their own password',
    };
    return { text: words[d.change] || 'Updated a staff account', area: 'Staff' };
  }
  if (a.resource === 'StaffInvite') return { text: 'Invited someone to a team', area: 'Staff' };
  if (a.resource === 'BankTransfer') {
    const words = { edited: 'Corrected a bank transfer', withdrawn: 'Withdrew a bank transfer', confirmed: 'Confirmed a bank transfer', rejected: 'Rejected a bank transfer' };
    return { text: a.action === 'CREATE' ? 'Recorded a bank transfer' : words[d.change] || 'Updated a bank transfer', area: 'Payments' };
  }
  return { text: `${String(a.action || '').toLowerCase()} ${a.resource || ''}`.trim(), area: a.resource || 'Other' };
}

/** Where an activity entry links to in the admin. */
const linkOf = (a) => {
  if (a.resource === 'Order' && a.resourceId) return `/admin/orders/${a.resourceId}`;
  if (a.resource === 'PaymentRequest') return '/admin/payments';
  if (a.resource === 'User' || a.resource === 'StaffInvite') return '/admin/staff';
  return null;
};

/** Earliest day the overview can be asked for — before the team panel existed. */
const FIRST_DAY = '2024-01-01';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + n * DAY).toISOString().slice(0, 10);
};

/**
 * The India calendar day the overview is for. No date (or today's) → the live
 * view, exactly as before. A past day → that day's window, 00:00–23:59:59.999 IST.
 * Unreal (2026-02-30), malformed, too early or future dates are a 400, never a
 * quiet fallback to today: the page would show today's numbers under the wrong date.
 *
 * `until` is the end of what the view may count — `now` for today, the next
 * midnight IST for a past day — so "the 7 days to X" and "1st of the month to X"
 * mean the same thing for both.
 */
export function overviewDay(date, now = Date.now()) {
  const today = istToday(now);
  if (date == null || date === '' || date === today) {
    return { date: today, isToday: true, dayStart: istStartOfDay(today), until: new Date(now) };
  }
  // `?date=a&date=b` arrives as an array: one day per request, never "the first one".
  if (typeof date !== 'string') throw fail('Pick one date (YYYY-MM-DD).', 400);
  const ymd = date;
  if (!YMD.test(ymd) || addDays(ymd, 0) !== ymd) throw fail('Pick a real date (YYYY-MM-DD).', 400);
  if (ymd > today) throw fail('That date is in the future.', 400);
  if (ymd < FIRST_DAY) throw fail(`Pick a date from ${FIRST_DAY} on.`, 400);
  return { date: ymd, isToday: false, dayStart: istStartOfDay(ymd), until: istStartOfDay(addDays(ymd, 1)) };
}

export async function companyOverview(actor, now = Date.now(), { date } = {}) {
  if (actor?.role !== 'admin') throw fail('Not authorized.', 403);
  const day = overviewDay(date, now);
  const { isToday, dayStart: todayStart, until } = day;
  const monthStart = istStartOfDay(`${day.date.slice(0, 7)}-01`);
  const weekAgo = new Date(until.getTime() - 7 * DAY);
  // A past day's upper bound; today's reads stay open-ended, exactly as before.
  const upTo = isToday ? null : until;

  const staff = await userRepository.findActiveStaff();
  const staffIds = staff.map((u) => u._id);

  // Current-state reads (queues, open tickets, who is online, overdue) have no
  // history to rebuild from; for a past day they are still read and returned
  // as "now", and `day.isToday: false` tells the page to label them so.
  const [
    paidToday, unpaidSales, pendingRefunds, requestsByStatus, paidThisMonth, paidAbroadThisMonth,
    newConsultations, consultationsReceived, openTickets, board, recentActions, actionsByUser, online, extrasToday,
  ] = await Promise.all([
    orderRepository.findPaidWorkflowOrdersSince(todayStart, 1000, upTo),
    orderRepository.findUnpaidSalesOrders(500),
    orderRepository.countPendingCancellationRefunds(),
    paymentRequestRepository.countByStatus(),
    paymentRequestRepository.paidSinceByTeam(monthStart, upTo),
    paymentRequestRepository.paidNoRupeesSince(monthStart, upTo),
    consultationRepository.count({ status: 'new' }),
    consultationRepository.count({ createdAt: { $gte: todayStart, $lt: until } }),
    supportTicketRepository.count({ status: { $in: ['new', 'open', 'pending_customer', 'on_hold'] } }),
    waitingBoard(actor, now),
    // Today: the newest actions, as before. A past day: that day's only.
    staffIds.length ? auditLogRepository.recentByUsers(staffIds, 60, isToday ? {} : { from: todayStart, until }) : [],
    staffIds.length ? auditLogRepository.countByUserSince(staffIds, weekAgo, { until: upTo, dayStart: todayStart }) : [],
    isToday ? onlineAmong(staffIds.map(idOf)).catch(() => new Set()) : new Set(),
    orderExtraChargeRepository.sumKept(todayStart, upTo),
  ]);

  // ── Today ──
  const gtmToday = paidToday.filter((o) => o.salesUser);
  const today = {
    paidOrders: paidToday.length,
    paidValue: round2(paidToday.reduce((s, o) => s + (o.totalAmount || 0), 0) + extrasToday),
    gtmOrders: gtmToday.length,
    websiteOrders: paidToday.length - gtmToday.length,
    newConsultations,
    consultationsReceived,
    openSupportTickets: openTickets,
    // Parked "On hold — customer thinking" until a follow-up date: not waiting on anyone yet.
    salesLinksWaiting: unpaidSales.filter((o) => o.status === 'awaiting_payment'
      && o.paymentLinkExpiresAt && new Date(o.paymentLinkExpiresAt).getTime() > now
      && !(o.salesHold?.until && new Date(o.salesHold.until).getTime() > now)).length,
  };

  // ── Money waiting ──
  // `pending`: foreign bills in the count whose rupees are recorded only when paid —
  // left out of `amount`, so the card can say so instead of looking complete.
  const by = Object.fromEntries(requestsByStatus.map((r) => [r._id, { n: r.n, amount: round2(r.amount), pending: r.pending || 0 }]));
  const zero = { n: 0, amount: 0, pending: 0 };
  const money = {
    // Accounts has not decided yet.
    awaitingApproval: by.submitted || zero,
    // Accounts approved it; the money leaves on the ADMIN's action. Named for
    // who must act, not for who looked at it last — the old `withAccounts` was
    // written when accounts paid, and read as the opposite of what it counts.
    toPay: {
      n: (by.approved?.n || 0) + (by.on_hold?.n || 0),
      amount: round2((by.approved?.amount || 0) + (by.on_hold?.amount || 0)),
      pending: (by.approved?.pending || 0) + (by.on_hold?.pending || 0),
      onHold: by.on_hold?.n || 0,
    },
    paidThisMonth: {
      n: paidThisMonth.reduce((s, r) => s + r.n, 0),
      amount: round2(paidThisMonth.reduce((s, r) => s + r.amount, 0)),
      byTeam: paidThisMonth.map((r) => ({ team: r._id, label: STAFF_TEAM_LABELS[r._id] || r._id, n: r.n, amount: round2(r.amount) })),
      // Paid from foreign-currency accounts: not rupees, so never in `amount` — per currency.
      foreign: paidAbroadThisMonth,
    },
    itemRefundsToPay: pendingRefunds,
  };

  // ── People ──
  const activity = new Map(actionsByUser.map((r) => [idOf(r._id), r]));
  const people = staff.map((u) => ({
    id: idOf(u),
    name: u.name,
    team: u.staff.team,
    teamLabel: STAFF_TEAM_LABELS[u.staff.team],
    role: staffRoleLabel(u),
    online: isToday ? online.has(idOf(u)) : null,
    actionsThisWeek: activity.get(idOf(u))?.n || 0,
    actionsOnDay: activity.get(idOf(u))?.nDay || 0,
    lastAction: activity.get(idOf(u))?.last || null,
  }));
  const waiting = Object.fromEntries((board.teams || []).map((t) => [t.team, t]));
  const teams = STAFF_TEAM_VALUES.map((team) => {
    const members = people.filter((p) => p.team === team);
    return {
      team,
      label: STAFF_TEAM_LABELS[team],
      members: members.length,
      // Presence is live only: there is no record of who was online on a past day.
      online: isToday ? members.filter((p) => p.online).length : null,
      waiting: waiting[team]?.waiting || 0,
      overdue: waiting[team]?.overdue || 0,
      actionsThisWeek: members.reduce((s, p) => s + p.actionsThisWeek, 0),
      actionsOnDay: members.reduce((s, p) => s + p.actionsOnDay, 0),
    };
  });

  // ── Activity feed ──
  const nameOf = new Map(staff.map((u) => [idOf(u), { name: u.name, team: STAFF_TEAM_LABELS[u.staff.team] }]));
  const feed = recentActions.map((a) => {
    const { text, area } = describeAction(a);
    const who = nameOf.get(idOf(a.user));
    return { at: a.createdAt, who: who?.name || 'Staff', team: who?.team || '', text, area, link: linkOf(a) };
  });

  return {
    generatedAt: new Date(now),
    // `isToday: false` → the queue/ticket/waiting figures are as of NOW, not this date.
    day: { date: day.date, isToday, monthFrom: istToday(monthStart.getTime()), weekFrom: weekAgo },
    today,
    money,
    teams,
    people: people.sort((a, b) => Number(b.online) - Number(a.online) || (b.lastAction ? new Date(b.lastAction) : 0) - (a.lastAction ? new Date(a.lastAction) : 0)),
    // "Overdue now" is live by definition; a past day would show today's list under its date.
    overdue: isToday ? (board.rows || []).filter((r) => r.overdue).slice(0, 10) : [],
    feed,
  };
}
