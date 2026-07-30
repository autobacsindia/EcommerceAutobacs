/**
 * Candidate-facing careers emails.
 *
 * Two messages go to the applicant (never the admin inbox — that's
 * adminNotificationService):
 *   - acknowledgement, right after they submit;
 *   - rejection, when an admin moves the application to "rejected".
 *
 * Enqueued from jobApplicationController and processed by the notification
 * worker (send-careers-acknowledgement / send-careers-rejection). DB access +
 * idempotency live here; the raw send is provider-only in emailHandler — mirrors
 * reviewRequestService / orderStatusEmailService.
 *
 * Idempotency: each send stamps a dedicated Date on the application only AFTER
 * the provider accepts it, so a BullMQ retry re-sends on transient failure but
 * never double-mails on success, and re-enqueues (e.g. an admin toggling status)
 * are no-ops.
 */

import jobApplicationRepository from '../repositories/jobApplicationRepository.js';
import emailHandler from './emailHandler.js';

// Tagged so the outcome of every candidate email is greppable in Railway logs
// (search "[CareersEmail]"). One line per attempt, with the applicant + outcome.
const log = (msg) => console.log(`[CareersEmail] ${msg}`);
const warn = (msg) => console.warn(`[CareersEmail] ${msg}`);

/**
 * Acknowledge a freshly-submitted application, once.
 * @param {string} applicationId
 * @returns {Promise<{status: 'sent'|'skipped'|'skipped-disabled'|'not-found'}>}
 */
export const emailCareersAcknowledgement = async (applicationId) => {
  const app = await jobApplicationRepository.findById(applicationId);
  if (!app) {
    warn(`acknowledgement: application ${applicationId} not found — nothing sent`);
    return { status: 'not-found' };
  }
  if (app.acknowledgementEmailedAt) {
    log(`acknowledgement: already sent to ${app.email} for ${applicationId} — skipping`);
    return { status: 'skipped' };
  }

  log(`acknowledgement: sending to ${app.email} for ${applicationId} (${app.roleTitle})…`);
  const result = await emailHandler.sendCareersAcknowledgement({ to: app.email, application: app });

  // Email simply disabled (no Postmark configured) — don't retry a config gap.
  if (result?.fallbackToConsole) {
    warn(`acknowledgement: email provider DISABLED — not delivered to ${app.email} for ${applicationId}`);
    return { status: 'skipped-disabled' };
  }

  if (result?.success) {
    app.acknowledgementEmailedAt = new Date();
    await jobApplicationRepository.save(app);
    log(`acknowledgement: SENT to ${app.email} for ${applicationId} (messageId=${result.messageId || 'n/a'})`);
    return { status: 'sent' };
  }

  warn(`acknowledgement: FAILED for ${applicationId} → ${result?.error || 'unknown error'} (will retry)`);
  throw new Error(
    `Careers acknowledgement email failed for application ${applicationId}: ${result?.error || 'unknown error'}`
  );
};

/**
 * Notify a candidate their application was not selected, once.
 * Guards on status so a stale/re-enqueued job can't mail a rejection after the
 * application was moved back out of "rejected".
 * @param {string} applicationId
 * @returns {Promise<{status: 'sent'|'skipped'|'skipped-disabled'|'not-found'|'not-rejected'}>}
 */
export const emailCareersRejection = async (applicationId) => {
  const app = await jobApplicationRepository.findById(applicationId);
  if (!app) {
    warn(`rejection: application ${applicationId} not found — nothing sent`);
    return { status: 'not-found' };
  }
  if (app.status !== 'rejected') {
    log(`rejection: application ${applicationId} is "${app.status}", not "rejected" — skipping`);
    return { status: 'not-rejected' };
  }
  if (app.rejectionEmailedAt) {
    log(`rejection: already sent to ${app.email} for ${applicationId} — skipping`);
    return { status: 'skipped' };
  }

  log(`rejection: sending to ${app.email} for ${applicationId} (${app.roleTitle})…`);
  const result = await emailHandler.sendCareersRejection({ to: app.email, application: app });

  if (result?.fallbackToConsole) {
    warn(`rejection: email provider DISABLED — not delivered to ${app.email} for ${applicationId}`);
    return { status: 'skipped-disabled' };
  }

  if (result?.success) {
    app.rejectionEmailedAt = new Date();
    await jobApplicationRepository.save(app);
    log(`rejection: SENT to ${app.email} for ${applicationId} (messageId=${result.messageId || 'n/a'})`);
    return { status: 'sent' };
  }

  warn(`rejection: FAILED for ${applicationId} → ${result?.error || 'unknown error'} (will retry)`);
  throw new Error(
    `Careers rejection email failed for application ${applicationId}: ${result?.error || 'unknown error'}`
  );
};

export default { emailCareersAcknowledgement, emailCareersRejection };
