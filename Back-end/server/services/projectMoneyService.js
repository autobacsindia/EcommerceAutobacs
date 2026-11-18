/**
 * A project's money: the "Money" box on its page in the staff Tasks module.
 *
 *   GET /staff/tasks/projects/:projectId/payments[?cursor=]
 *
 * The payments linked to the project (PaymentRequest.project), newest first, and
 * what they add up to — paid and still waiting — summed here on the server.
 *
 * Who sees it (the owner's call, 2026-11-17): the admin, the Accounts team and
 * the project's owner. Members and team heads do not: a project they can open
 * answers 403, one they cannot open (or that does not exist) answers 404 — never
 * a 200 with the money left out. An archived project's money stays visible to
 * those same people (its old links stay).
 *
 * Read-only. The list is keyset-paged and bounded (linkLookupService.paymentPage,
 * index payment_request_project); the totals come with the first page only.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { categoryLabel } from '../config/expenseCategories.js';
import { paymentPage, paymentRow, paymentTotals } from './linkLookupService.js';
import { projectCode, seesProject } from './staffProjectService.js';

/** How much of a payment's description the list shows ("what for"). */
export const PURPOSE_MAX = 140;

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v?._id ?? v)?.toString();
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isAccounts = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.ACCOUNTS;
const isOwner = (u, p) => isActiveStaff(u) && idOf(p.owner?.user) === idOf(u?._id);

/** The admin, Accounts and the project's owner. */
export const seesProjectMoney = (u, p) => !!p && (isAdmin(u) || isAccounts(u) || isOwner(u, p));

/** Who may open the payment itself (the same rule as the Payments list). */
const opensPayment = (u, r) => isAdmin(u) || isAccounts(u) || (isActiveStaff(u) && u.staff.team === r.team);

function purposeOf(r) {
  const text = String(r.purpose || '').replace(/\s+/g, ' ').trim()
    || (r.itemNames || []).filter(Boolean).join(', ');
  return text.length > PURPOSE_MAX ? `${text.slice(0, PURPOSE_MAX - 1).trimEnd()}…` : text;
}

export async function projectMoney(actor, projectId, { cursor } = {}) {
  const gone = () => fail('That project no longer exists.', 404);
  if (!mongoose.isValidObjectId(projectId)) throw gone();
  const p = await staffProjectRepository.findById(projectId);
  if (!p) throw gone();
  if (!seesProjectMoney(actor, p)) {
    // Someone who can open the project is told why; anyone else learns nothing about it.
    if (seesProject(actor, p)) throw fail('Only the project owner, Accounts and the admin see a project’s money.', 403);
    throw gone();
  }

  const shape = (r) => ({
    ...paymentRow(r),
    categoryLabel: r.kind === 'supplier' ? 'Supplier' : categoryLabel(r.category),
    purpose: purposeOf(r),
    canOpen: opensPayment(actor, r),
  });
  const by = { project: p._id };
  // Read a little more than is shown, so collapsing runs of spaces still fills the line.
  const read = { shape, purposeChars: PURPOSE_MAX * 2 };
  if (cursor) return { payments: await paymentPage(by, cursor, read) };

  const [payments, totals] = await Promise.all([paymentPage(by, null, read), paymentTotals(p._id)]);
  return {
    project: { id: idOf(p._id), code: projectCode(p.number), name: p.name, archived: !!p.archivedAt },
    totals,
    payments,
  };
}
