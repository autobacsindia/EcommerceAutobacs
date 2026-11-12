/**
 * "Above 10%: prior approval mandatory" — the approval step for GTM quotations
 * (utils/discountApproval.js has the rule; salesQuotationService enforces it at
 * PDF / accept and voids an approval when the prices change).
 *
 *   request → the seller (or the GTM head on a seller's quotation) asks, with a
 *             reason. Idempotent: asking again for the same prices returns the
 *             request already there. Approvers get a push notification.
 *   decide  → the GTM head (for their own team, never their own quotation or their
 *             own request) or an admin approves or rejects, with a note (required
 *             to reject). Compare-and-set on the pending request for THESE prices,
 *             so a double-click is one decision and a click on prices that changed
 *             since is refused. The seller gets a push notification.
 *
 * Every step is audited. Nothing here touches money: the amounts were computed by
 * the server when the quotation was saved, and approval only unlocks sharing it.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import salesQuotationRepository from '../repositories/salesQuotationRepository.js';
import userRepository from '../repositories/userRepository.js';
import { sendToUsers } from './pushService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import {
  APPROVAL_STATUSES, approvalState, cleanApprovalNote, cleanApprovalReason, priceKeyOf,
} from '../utils/discountApproval.js';
import { loadReadable, mayAct, printedNumber, shapeQuotation } from './salesQuotationService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isAdmin = (u) => u?.role === 'admin';
const isActiveHead = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.isHead === true;
const pct = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/**
 * May `actor` decide on `q`? Admin: any. A team head: only for a seller on their
 * own team, and never their own quotation or a request they made themselves.
 * @returns {string|null} why not, or null when allowed
 */
export function whyCannotApprove(actor, q, seller) {
  if (isAdmin(actor)) return null;
  if (!isActiveHead(actor)) return 'Only the GTM head or an admin can approve a discount above 10%.';
  if (!seller?.staff?.team || seller.staff.team !== actor.staff.team || actor.staff.team !== STAFF_TEAMS.SALES) {
    return "You can approve discounts only for your own team's quotations.";
  }
  if (idOf(q.salesUser) === idOf(actor._id)) return 'You cannot approve your own quotation — an admin or another GTM head must.';
  if (q.discountApproval?.requestedBy && idOf(q.discountApproval.requestedBy) === idOf(actor._id)) {
    return 'You asked for this approval, so someone else must give it.';
  }
  return null;
}

const loadSeller = (q) => userRepository.model.findById(idOf(q.salesUser)).select('name role staff').lean();

/** Who gets the "approval needed" pop-up: admins and the seller's team heads (not the seller or requester). */
async function notifyApprovers(q, actor) {
  try {
    const people = await userRepository.model.find({
      $or: [{ role: 'admin' }, { role: 'staff', 'staff.active': true, 'staff.team': STAFF_TEAMS.SALES, 'staff.isHead': true }],
      _id: { $nin: [idOf(q.salesUser), idOf(actor._id)] },
    }).select('_id role').lean();
    if (!people.length) return;
    const a = q.discountApproval;
    await sendToUsers(
      people.map((u) => ({
        userId: idOf(u._id),
        url: isAdmin(u) ? '/admin/discount-approvals' : `/team/sales/quotations/${idOf(q._id)}`,
      })),
      {
        title: `Discount approval: ${pct(a.percent)} on ${printedNumber(q)}`,
        body: `${a.requestedByName || 'A seller'} asks for ${pct(a.percent)} off for ${q.customer?.name || 'a customer'}: ${a.reason}`,
        tag: `quote-approval-${idOf(q._id)}`,
      },
    );
  } catch (err) {
    console.error('[QuotationApproval] push to approvers failed (ignored):', err.message);
  }
}

async function notifySeller(q) {
  try {
    const a = q.discountApproval;
    const word = a.status === APPROVAL_STATUSES.APPROVED ? 'approved' : 'rejected';
    const to = [...new Set([idOf(q.salesUser), idOf(a.requestedBy)])].filter((id) => id && id !== idOf(a.decidedBy));
    if (!to.length) return;
    await sendToUsers(
      to.map((userId) => ({ userId, url: `/team/sales/quotations/${idOf(q._id)}` })),
      {
        title: `Discount ${word}: ${printedNumber(q)}`,
        body: `${a.decidedByName || 'The approver'} ${word} ${pct(a.percent)} off${a.note ? `: ${a.note}` : ''}`,
        tag: `quote-approval-${idOf(q._id)}`,
      },
    );
  } catch (err) {
    console.error('[QuotationApproval] push to seller failed (ignored):', err.message);
  }
}

const reload = (id) => salesQuotationRepository.model.findById(id).populate('salesUser', 'name').lean();

/** The seller asks for approval of the quotation's current prices. */
export async function requestApproval(actor, id, input = {}, req) {
  const q = await loadReadable(actor, id);
  if (!mayAct(actor, q)) throw fail('You can only ask for approval on your own quotations.', 403);
  if (q.status !== 'open') throw fail(`This quotation is already ${q.status}.`, 409);
  const s = approvalState(q);
  if (s.state === 'not_needed') throw fail('This discount is 10% or less — no approval is needed.', 409);
  // Same prices, already asked or approved: the second click changes nothing.
  if (s.state === APPROVAL_STATUSES.PENDING || s.state === APPROVAL_STATUSES.APPROVED) return shapeQuotation(q);

  const { reason, error } = cleanApprovalReason(input.reason);
  if (error) throw fail(error, 400);
  const key = priceKeyOf(q);
  const record = {
    status: APPROVAL_STATUSES.PENDING,
    priceKey: key,
    version: q.version,
    percent: s.percent,
    maxLinePercent: s.maxLinePercent,
    totalPercent: s.totalPercent,
    totalAmount: q.totalAmount,
    reason,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    requestedAt: new Date(),
  };
  // Only over what we just read (no request / an old one / a rejection), and only
  // at this version — two clicks race to one request, an edit meanwhile wins.
  const previous = s.state === APPROVAL_STATUSES.REJECTED
    ? { 'discountApproval.status': APPROVAL_STATUSES.REJECTED, 'discountApproval.priceKey': key }
    : { $or: [{ discountApproval: { $exists: false } }, { 'discountApproval.priceKey': { $ne: key } }] };
  const updated = await salesQuotationRepository.model.findOneAndUpdate(
    { _id: q._id, status: 'open', version: q.version, ...previous },
    { $set: { discountApproval: record } },
    { new: true },
  ).populate('salesUser', 'name').lean();

  if (!updated) {
    const now = await reload(q._id);
    const st = now && approvalState(now).state;
    if (now && now.version === q.version && (st === APPROVAL_STATUSES.PENDING || st === APPROVAL_STATUSES.APPROVED)) return shapeQuotation(now);
    throw fail('This quotation was changed just now — reload it and try again.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, {
    change: 'discount_approval_requested', version: q.version, discountPercent: s.percent,
    maxLinePercent: s.maxLinePercent, totalPercent: s.totalPercent, totalAmount: q.totalAmount, reason,
    ...(s.state === APPROVAL_STATUSES.REJECTED && { afterRejection: true }),
  });
  await notifyApprovers(updated, actor);
  return shapeQuotation(updated);
}

/**
 * The GTM head / an admin approves or rejects.
 * @param {{ decision: 'approve'|'reject', note?: string, priceKey?: string }} input
 *   priceKey: the prices the approver was looking at; refused if they changed since.
 */
export async function decideApproval(actor, id, input = {}, req) {
  const decision = input.decision === 'approve' ? APPROVAL_STATUSES.APPROVED
    : input.decision === 'reject' ? APPROVAL_STATUSES.REJECTED : null;
  if (!decision) throw fail('Choose approve or reject.', 400);
  const note = cleanApprovalNote(input.note);
  if (decision === APPROVAL_STATUSES.REJECTED && note.length < 3) throw fail('Write a short note saying why it is rejected.', 400);

  const q = await loadReadable(actor, id);
  const why = whyCannotApprove(actor, q, await loadSeller(q));
  if (why) throw fail(why, 403);
  if (q.status !== 'open') throw fail(`This quotation is already ${q.status}.`, 409);

  const key = priceKeyOf(q);
  if (input.priceKey && input.priceKey !== key) {
    throw fail('The prices on this quotation changed since you opened it. Reload it and look again.', 409);
  }
  const s = approvalState(q);
  // A repeat of the decision already made (double-click) returns it; the opposite is refused.
  if (s.state === decision) return shapeQuotation(q);
  if (s.state !== APPROVAL_STATUSES.PENDING) {
    throw fail(s.state === 'not_needed' || s.state === 'needed'
      ? 'There is no approval request waiting on these prices.'
      : `This request was already ${s.state}.`, 409);
  }

  const updated = await salesQuotationRepository.model.findOneAndUpdate(
    { _id: q._id, status: 'open', 'discountApproval.status': APPROVAL_STATUSES.PENDING, 'discountApproval.priceKey': key },
    {
      $set: {
        'discountApproval.status': decision,
        'discountApproval.decidedBy': actor._id,
        'discountApproval.decidedByName': actor.name || '',
        'discountApproval.decidedRole': isAdmin(actor) ? 'admin' : 'head',
        'discountApproval.decidedAt': new Date(),
        'discountApproval.note': note,
      },
    },
    { new: true },
  ).populate('salesUser', 'name').lean();

  if (!updated) {
    const now = await reload(q._id);
    if (now && approvalState(now).state === decision && idOf(now.discountApproval?.decidedBy) === idOf(actor._id)) return shapeQuotation(now);
    throw fail('This quotation or its request changed just now — reload it.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'SalesQuotation', q._id, {
    change: decision === APPROVAL_STATUSES.APPROVED ? 'discount_approved' : 'discount_rejected',
    version: q.version, discountPercent: q.discountApproval.percent, totalAmount: q.totalAmount,
    seller: idOf(q.salesUser), requestedBy: idOf(q.discountApproval.requestedBy),
    approverRole: isAdmin(actor) ? 'admin' : 'head', note,
  });
  await notifySeller(updated);
  return shapeQuotation(updated);
}

/** Can this person decide on this quotation's request? (for the detail screen) */
export async function canDecide(actor, q) {
  if (approvalState(q).state !== APPROVAL_STATUSES.PENDING || q.status !== 'open') return false;
  if (isAdmin(actor)) return true;
  if (!isActiveHead(actor)) return false;
  return whyCannotApprove(actor, q, await loadSeller(q)) === null;
}

export default { requestApproval, decideApproval, canDecide, whyCannotApprove };
