/**
 * "What is waiting for ME right now?" — the bell in the staff header.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Work arrives in queues scattered across the panel: a payment waiting for
 * accounts to approve, an approved one waiting for the admin to pay, a refund
 * to send. Nothing announced any of it, so the only way to find out was to open
 * each section and look — which people did a few times a day, or forgot to.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * Not a feed, and not a per-item notification store. It answers one question
 * with one number per queue, so it can be polled cheaply and can never drift
 * from the lists it points at: every count here is the same query the page
 * itself runs. A stored notification table would be a second source of truth
 * that goes stale the moment someone acts in another tab.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * Each item is only ever returned to the people whose job it is. Accounts does
 * not see "to pay" (they cannot pay), the admin does not see "to approve"
 * (they do not approve any more), and a team that raises requests sees neither
 * — its own requests are not work waiting on it. Chat unread is deliberately
 * absent: the client already has it per channel, and asking the server for a
 * number it would only add to another is a round trip for nothing.
 */
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { countPending as countPendingBankTransfers } from './bankTransferService.js';
import { countDueForBell as countTasksDue } from './staffTaskService.js';
import { countTrainingForBell } from './staffTrainingService.js';
import { countsFor as countReturnsFor } from './returnService.js';
import { countUnread as countInboxUnread } from './staffTaskInboxService.js';

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u?.staff?.active === true;
const isAccounts = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.ACCOUNTS;

/**
 * Everything waiting on `user`, newest counts straight from the source tables.
 *
 * @param {object} user
 * `total` counts WORK only — it is what rings the bell's "new work" alert. A
 * row marked `quiet` (unread task updates) shows with its count but stays out
 * of it: every comment would otherwise ring an alarm meant for payments, and
 * those updates already arrive as pop-ups.
 *
 * @returns {Promise<{items: {key: string, label: string, count: number, href: string, quiet?: boolean}[], total: number}>}
 */
export async function summaryFor(user) {
  const items = [];
  if (!isAdmin(user) && !isActiveStaff(user)) return { items, total: 0 };

  const wantsPayments = isAdmin(user) || isAccounts(user);
  // One aggregate covers both payment queues; refunds are a separate table.
  const [byStatus, refunds, transfers, tasksDue, returnItems, inboxUnread] = await Promise.all([
    wantsPayments ? paymentRequestRepository.countByStatus() : Promise.resolve([]),
    isAdmin(user) || isAccounts(user) ? orderRepository.countPendingCancellationRefunds() : Promise.resolve(0),
    // A small collection (a handful of rows a week), so a count is cheap.
    wantsPayments ? countPendingBankTransfers() : Promise.resolve(0),
    // One index range (staff_task_assignee): this person's open tasks due by today.
    countTasksDue(user),
    // Returns waiting on this person's team — the same queries as the return lists.
    countReturnsFor(user),
    // One covered count on staff_task_inbox_list, capped (the badge shows "99+").
    countInboxUnread(user),
  ]);
  const n = (status) => byStatus.find((r) => r._id === status)?.n || 0;

  if (isAccounts(user)) {
    items.push({
      key: 'payments_to_approve',
      label: 'Payments to approve',
      count: n('submitted'),
      href: '/team/payments',
    });
  }

  if (isAdmin(user)) {
    items.push({
      key: 'payments_to_pay',
      label: 'Approved payments to pay',
      count: n('approved') + n('on_hold'),
      href: '/admin/payments',
    });
  }

  if (refunds > 0 || isAccounts(user)) {
    items.push({
      key: 'refunds_to_send',
      label: 'Refunds to send',
      count: refunds,
      href: isAdmin(user) ? '/admin/orders?refunds=pending' : '/team/refunds',
    });
  }

  // A customer paid a sales order by bank transfer: accounts (or the admin) checks the bank.
  if (wantsPayments) {
    items.push({
      key: 'bank_transfers_to_verify',
      label: 'Bank transfers to check',
      count: transfers,
      href: isAdmin(user) ? '/admin/bank-transfers' : '/team/bank-transfers',
    });
  }

  // Tasks given to this person that are overdue or due today. Shown only when
  // there are some: anyone can have tasks, so a permanent "0" row would sit in
  // every dropdown and tell nobody anything.
  if (tasksDue > 0) {
    items.push({
      key: 'tasks_due',
      label: 'My tasks due or overdue',
      count: tasksDue,
      href: isAdmin(user) ? '/admin/tasks?due=late' : '/team/tasks?due=late',
    });
  }

  // Tests to mark, sign-offs, and people out of attempts. Only when there are some.
  const trainingWaiting = await countTrainingForBell(user);
  if (trainingWaiting > 0) {
    items.push({
      key: 'training_waiting',
      label: 'Training waiting on you',
      count: trainingWaiting,
      href: isAdmin(user) ? '/admin/training?view=team' : '/team/training?view=team',
    });
  }

  items.push(...returnItems);

  // What happened on this person's tasks that they have not read (the Inbox).
  if (inboxUnread > 0) {
    items.push({
      key: 'tasks_inbox',
      label: 'Unread task updates',
      count: inboxUnread,
      href: isAdmin(user) ? '/admin/tasks?view=inbox' : '/team/tasks?view=inbox',
      quiet: true,
    });
  }

  // Zero-count rows are kept so the dropdown can say "nothing waiting" for a
  // queue that IS yours, rather than hiding it and looking like it vanished.
  return { items, total: items.reduce((t, i) => t + (i.quiet ? 0 : i.count), 0) };
}
