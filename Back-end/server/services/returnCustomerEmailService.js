/**
 * Customer-facing return emails.
 *
 * Enqueued from returnController and processed by the notification worker
 * (send-return-submitted / send-return-status-email). DB access lives here; the
 * raw send is provider-only in emailHandler — mirrors careersApplicantEmailService.
 *
 * Idempotency: the "submitted" acknowledgement stamps submittedEmailedAt only
 * AFTER the provider accepts it, so a BullMQ retry re-sends on transient failure
 * but never double-mails on success. Status emails (approved/received/rejected/
 * refunded) fire once per operator action, so they are not separately de-duped.
 */

import returnRequestRepository from '../repositories/returnRequestRepository.js';
import emailHandler from './emailHandler.js';
import companyInfo from '../config/company.js';
import { returnEmail } from '../utils/returnEmailTemplates.js';

const log = (msg) => console.log(`[ReturnEmail] ${msg}`);
const warn = (msg) => console.warn(`[ReturnEmail] ${msg}`);

/** Load a return with the fields the templates need. */
const loadReturn = (returnId) =>
  returnRequestRepository.findById(returnId)
    .populate('user', 'name email')
    .populate('order', 'orderNumber')
    .populate('items.product', 'name');

const recipientEmail = (rr) =>
  (rr.user && typeof rr.user === 'object' ? rr.user.email : null) || null;

/**
 * Acknowledge a freshly-submitted return, once.
 * @param {string} returnId
 * @returns {Promise<{status: 'sent'|'skipped'|'skipped-disabled'|'not-found'|'no-recipient'}>}
 */
export const emailReturnSubmitted = async (returnId) => {
  const rr = await loadReturn(returnId);
  if (!rr) { warn(`submitted: return ${returnId} not found`); return { status: 'not-found' }; }
  if (rr.submittedEmailedAt) { log(`submitted: already sent for ${returnId} — skipping`); return { status: 'skipped' }; }
  const to = recipientEmail(rr);
  if (!to) return { status: 'no-recipient' };

  const { subject, text, html } = returnEmail({ event: 'submitted', rr, order: rr.order, company: companyInfo });
  const result = await emailHandler.sendEmail({ to, subject, text, html });

  if (result?.fallbackToConsole) return { status: 'skipped-disabled' };
  if (result?.success) {
    rr.submittedEmailedAt = new Date();
    await returnRequestRepository.save(rr);
    log(`submitted: SENT to ${to} for ${returnId}`);
    return { status: 'sent' };
  }
  throw new Error(`Return submitted email failed for ${returnId}: ${result?.error || 'unknown error'}`);
};

/**
 * Send a lifecycle status email (approved / courier_booked / received / rejected / refunded).
 * @param {string} returnId
 * @param {'approved'|'courier_booked'|'received'|'rejected'|'refunded'} event
 * @returns {Promise<{status: 'sent'|'skipped-disabled'|'not-found'|'no-recipient'}>}
 */
export const emailReturnStatus = async (returnId, event) => {
  const rr = await loadReturn(returnId);
  if (!rr) { warn(`${event}: return ${returnId} not found`); return { status: 'not-found' }; }
  const to = recipientEmail(rr);
  if (!to) return { status: 'no-recipient' };

  const { subject, text, html } = returnEmail({ event, rr, order: rr.order, company: companyInfo });
  const result = await emailHandler.sendEmail({ to, subject, text, html });

  if (result?.fallbackToConsole) return { status: 'skipped-disabled' };
  if (result?.success) {
    log(`${event}: SENT to ${to} for ${returnId}`);
    return { status: 'sent' };
  }
  throw new Error(`Return ${event} email failed for ${returnId}: ${result?.error || 'unknown error'}`);
};

export default { emailReturnSubmitted, emailReturnStatus };
