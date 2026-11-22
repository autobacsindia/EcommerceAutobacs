/**
 * A task's money: the "Reimbursements" box on its page in the staff Tasks module.
 *
 *   GET /staff/tasks/:id/payments[?cursor=]
 *
 * The payments linked to the task (PaymentRequest.task — usually fuel / food
 * reimbursements for a pickup), newest first, each with its status, and what they
 * add up to — paid and still waiting — summed here on the server.
 *
 * Who sees it: the admin, Accounts, whoever created the task and whoever is doing
 * it. Followers and team-mates who can open the task get 403; anyone who cannot
 * open it gets 404 — never a 200 with the money left out.
 *
 * Read-only. Keyset-paged and bounded (linkLookupService.paymentPage, index
 * payment_request_task); the totals come with the first page only.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { paymentPage, paymentRow, totalsOf } from './linkLookupService.js';
import { canSee, peopleOf } from './staffTaskService.js';
import { expenseLabel } from './paymentRequestService.js';
import { claimLabel } from './reimbursement.js';
import { taskCode } from './taskLink.js';
import { PURPOSE_MAX } from './projectMoneyService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v?._id ?? v)?.toString();
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isAccounts = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.ACCOUNTS;

/** The admin, Accounts, the task's creator and the people doing it. */
export const seesTaskMoney = (u, t) => !!t && (isAdmin(u) || isAccounts(u)
  || (isActiveStaff(u) && (idOf(t.createdBy) === idOf(u._id) || peopleOf(t).some((p) => idOf(p.user) === idOf(u._id)))));

/** Who may open the payment itself (the same rule as the Payments list). */
const opensPayment = (u, r) => isAdmin(u) || isAccounts(u) || (isActiveStaff(u) && u.staff.team === r.team);

const purposeOf = (r) => {
  const text = String(r.purpose || '').replace(/\s+/g, ' ').trim();
  return text.length > PURPOSE_MAX ? `${text.slice(0, PURPOSE_MAX - 1).trimEnd()}…` : text;
};

export async function taskMoney(actor, taskId, { cursor } = {}) {
  const gone = () => fail('That task no longer exists.', 404);
  if (!mongoose.isValidObjectId(taskId)) throw gone();
  const t = await staffTaskRepository.findById(taskId);
  if (!t || !canSee(actor, t)) throw gone();
  if (!seesTaskMoney(actor, t)) throw fail('Only whoever created or is doing the task, Accounts and the admin see its money.', 403);

  const shape = (r) => ({
    ...paymentRow(r),
    categoryLabel: r.kind === 'supplier' ? 'Supplier' : expenseLabel(r),
    claim: r.reimbursement?.type ? claimLabel(r.reimbursement) : '',
    purpose: purposeOf(r),
    canOpen: opensPayment(actor, r),
  });
  const by = { task: t._id };
  const read = { shape, purposeChars: PURPOSE_MAX * 2 };
  if (cursor) return { payments: await paymentPage(by, cursor, read) };

  const [payments, rows] = await Promise.all([paymentPage(by, null, read), paymentRequestRepository.totalsForTask(t._id)]);
  return {
    task: { id: idOf(t._id), code: taskCode(t.number), title: t.title || '' },
    totals: totalsOf(rows),
    payments,
  };
}
