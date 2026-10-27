/**
 * The careers mailbox receives EMPLOYMENT email only.
 *
 * It is the hiring team's inbox: job applications land there, and candidates'
 * replies come back to it. Store email — overdue orders, new orders, refunds,
 * returns, team alerts — must never reach it, however the address ended up on a
 * list (a shared ADMIN_NOTIFICATION_EMAILS, a staff login on that address, the
 * overdue report's To:). emailHandler.sendEmail enforces this for every send, so
 * a store email added later cannot leak into it either.
 *
 *   CAREERS_NOTIFICATION_EMAILS — comma-separated; where "new job application"
 *                                 alerts go. Also the employment-only list.
 *   CAREERS_FROM_EMAIL          — the address candidate emails are sent from
 *                                 (replies land there), so it is the careers
 *                                 mailbox too even when the list above is unset.
 *
 * Pure: reads the environment on every call, so a Railway variable change takes
 * effect on the next send.
 */

/** What an email is for. Only `careers` may go to the careers mailbox. */
export const MAIL_PURPOSE = Object.freeze({ CAREERS: 'careers' });

const split = (raw) => String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Where "new job application" alerts go (empty when neither variable is set). */
export function careersAlertRecipients() {
  const listed = split(process.env.CAREERS_NOTIFICATION_EMAILS);
  return [...new Set(listed.length ? listed : split(process.env.CAREERS_FROM_EMAIL))];
}

/** Every address that receives employment email only. */
export function careersMailboxes() {
  return new Set([...split(process.env.CAREERS_NOTIFICATION_EMAILS), ...split(process.env.CAREERS_FROM_EMAIL)]);
}

/** Is `address` a careers mailbox (case-insensitive)? */
export function isCareersMailbox(address) {
  const a = String(address || '').trim().toLowerCase();
  return !!a && careersMailboxes().has(a);
}
