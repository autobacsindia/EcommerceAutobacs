/**
 * Support pipeline health — the two sweeps that catch silent failure.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dangerous failures in a support system are the QUIET ones. If the inbound
 * webhook breaks, no error surfaces anywhere: tickets simply stop arriving, the
 * inbox looks calm, and customers are ignored for days while the dashboard shows
 * zero problems. Same for SLA timers — BullMQ delayed jobs live in Redis, and a
 * Redis flush (which has happened on this stack before) silently drops every
 * pending breach alert.
 *
 * So both are backed by a periodic sweep that re-derives the truth from Mongo:
 *   - checkInboundLiveness(): "have we heard ANYTHING recently?"
 *   - sweepSlaBreaches():     "is anything overdue that nobody flagged?"
 *
 * This is the same safety-net pattern as paymentReconciliationService: timers
 * are the fast path, the sweep is what makes it correct.
 */

import inboundEmailRepository from '../repositories/inboundEmailRepository.js';
import ticketRepository from '../repositories/supportTicketRepository.js';
import emailHandler from './emailHandler.js';
import companyInfo from '../config/company.js';
import { isWithinBusinessHours } from '../utils/businessHours.js';
import { formatDateTimeIST } from '../utils/datetime.js';
import { SUPPORT_HOLIDAYS } from '../config/supportPolicy.js';

/** Internal alert recipients — mirrors adminNotificationService. */
const alertRecipients = () => {
  const raw =
    process.env.ADMIN_NOTIFICATION_EMAILS ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    companyInfo.email;
  return [...new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean))];
};

const appUrl = () => (process.env.FRONTEND_URL || 'https://autobacsindia.com').replace(/\/$/, '');

/**
 * Hours of total inbound silence, during business hours, before we alert.
 *
 * Tuned to be quiet but not useless: a genuinely slow afternoon on a small store
 * can pass without a single email, so too low a threshold trains the team to
 * ignore the alert. Four business hours of complete silence is abnormal.
 */
const SILENCE_ALERT_HOURS = Number(process.env.SUPPORT_SILENCE_ALERT_HOURS || 4);

const sendAlert = async (subject, lines) => {
  const to = alertRecipients();
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;">
    <p style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#dc2626;">${companyInfo.name} · Support alert</p>
    ${lines.map((l) => `<p style="margin:0 0 8px;">${l}</p>`).join('')}
  </div>`;

  for (const recipient of to) {
    await emailHandler.sendEmail({ to: recipient, subject, text, html });
  }
};

/**
 * Alert if no inbound email has been captured for an abnormally long stretch of
 * business hours.
 *
 * Only fires DURING business hours: overnight and Sunday silence is expected and
 * alerting on it is how a monitor gets muted.
 *
 * @returns {Promise<{ alerted: boolean, reason?: string, lastReceivedAt?: Date }>}
 */
export const checkInboundLiveness = async () => {
  if (!isWithinBusinessHours(new Date(), SUPPORT_HOLIDAYS)) {
    return { alerted: false, reason: 'outside business hours' };
  }

  const lastReceivedAt = await inboundEmailRepository.lastReceivedAt();

  // Nothing ever received. Expected before the Postmark inbound stream is wired
  // up, so this is not treated as an incident — the runbook covers first setup.
  if (!lastReceivedAt) {
    return { alerted: false, reason: 'no inbound email ever received' };
  }

  const hoursSince = (Date.now() - new Date(lastReceivedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSince < SILENCE_ALERT_HOURS) {
    return { alerted: false, reason: 'recent activity', lastReceivedAt };
  }

  await sendAlert(
    `⚠️ No support email received in ${Math.floor(hoursSince)}h`,
    [
      `No inbound email has reached the support pipeline since <strong>${formatDateTimeIST(lastReceivedAt)}</strong>.`,
      'This is usually a broken pipe, not a quiet day. Check, in order:',
      '1. Postmark → Servers → Inbound stream: is the webhook returning 200?',
      '2. Google Workspace → the routing rule forwarding support@ to the Postmark inbound address.',
      '3. Railway logs for <code>[SupportInbound]</code> rejections (401 = bad secret, 403 = IP not allowlisted).',
      `Inbox: ${appUrl()}/admin/support`,
    ]
  );

  return { alerted: true, lastReceivedAt, hoursSince };
};

/**
 * Flag tickets whose first-response deadline has passed without a reply.
 *
 * Idempotent: only picks up tickets not already flagged, so re-running never
 * re-alerts. This is the reconciliation net behind the BullMQ delayed jobs.
 *
 * @returns {Promise<{ flagged: number }>}
 */
export const sweepSlaBreaches = async () => {
  const overdue = await ticketRepository.findUnflaggedFirstResponseBreaches(new Date());
  if (overdue.length === 0) return { flagged: 0 };

  // Mark first, alert second: if the email fails we must not re-flag and
  // re-alert on the next sweep.
  await Promise.all(
    overdue.map((t) =>
      ticketRepository.update(t._id, { $set: { firstResponseBreached: true } })
    )
  );

  await sendAlert(
    `⚠️ ${overdue.length} support ticket${overdue.length === 1 ? '' : 's'} past first-response SLA`,
    [
      `${overdue.length} ticket${overdue.length === 1 ? ' has' : 's have'} passed the first-response deadline with no reply:`,
      ...overdue.slice(0, 15).map(
        (t) =>
          `<strong>${t.reference}</strong> — ${t.subject} ` +
          `(${t.requester?.email || 'unknown'}, due ${formatDateTimeIST(t.firstResponseDueAt)})`
      ),
      overdue.length > 15 ? `…and ${overdue.length - 15} more.` : '',
      `Inbox: ${appUrl()}/admin/support`,
    ].filter(Boolean)
  );

  return { flagged: overdue.length };
};

/**
 * Retry inbound emails that were captured but never processed — typically a
 * Redis outage at capture time, so the job was never enqueued.
 *
 * @returns {Promise<{ requeued: number }>}
 */
export const requeueStuckInbound = async (enqueue) => {
  const stuck = await inboundEmailRepository.findStuck({ maxAttempts: 5, limit: 50 });
  if (stuck.length === 0) return { requeued: 0 };

  for (const row of stuck) {
    try {
      await enqueue('process-inbound-email', { inboundId: String(row._id) });
    } catch (err) {
      console.error(`[SupportHealth] Failed to requeue inbound ${row._id}:`, err?.message);
    }
  }
  return { requeued: stuck.length };
};

export default { checkInboundLiveness, sweepSlaBreaches, requeueStuckInbound };
