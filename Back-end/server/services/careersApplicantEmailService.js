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

/**
 * Acknowledge a freshly-submitted application, once.
 * @param {string} applicationId
 * @returns {Promise<{status: 'sent'|'skipped'|'skipped-disabled'|'not-found'}>}
 */
export const emailCareersAcknowledgement = async (applicationId) => {
  const app = await jobApplicationRepository.findById(applicationId);
  if (!app) return { status: 'not-found' };
  if (app.acknowledgementEmailedAt) return { status: 'skipped' };

  const result = await emailHandler.sendCareersAcknowledgement({ to: app.email, application: app });

  // Email simply disabled (no Postmark configured) — don't retry a config gap.
  if (result?.fallbackToConsole) return { status: 'skipped-disabled' };

  if (result?.success) {
    app.acknowledgementEmailedAt = new Date();
    await jobApplicationRepository.save(app);
    return { status: 'sent' };
  }

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
  if (!app) return { status: 'not-found' };
  if (app.status !== 'rejected') return { status: 'not-rejected' };
  if (app.rejectionEmailedAt) return { status: 'skipped' };

  const result = await emailHandler.sendCareersRejection({ to: app.email, application: app });

  if (result?.fallbackToConsole) return { status: 'skipped-disabled' };

  if (result?.success) {
    app.rejectionEmailedAt = new Date();
    await jobApplicationRepository.save(app);
    return { status: 'sent' };
  }

  throw new Error(
    `Careers rejection email failed for application ${applicationId}: ${result?.error || 'unknown error'}`
  );
};

export default { emailCareersAcknowledgement, emailCareersRejection };
