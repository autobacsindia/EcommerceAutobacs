/**
 * HR → applicant reply from the admin careers inbox.
 *
 * Synchronous on purpose (not queued): HR clicked "Send" and is waiting for the
 * answer, so the request returns the provider's real verdict — "sent" or the
 * reason it failed. emailHandler already retries transient provider errors.
 *
 * Idempotency: the client sends a key per draft. claimReply atomically records
 * the reply as 'sending' only if that key is new, so a double-click, a client
 * retry or two tabs submitting the same draft produce ONE email. The losing
 * request gets the existing record back instead of sending again.
 */

import jobApplicationRepository from '../repositories/jobApplicationRepository.js';
import { REPLY_LIMIT } from '../models/JobApplication.js';
import emailHandler from './emailHandler.js';

const log = (msg) => console.log(`[CareersReply] ${msg}`);
const warn = (msg) => console.warn(`[CareersReply] ${msg}`);

export const SUBJECT_MAX = 200;
export const MESSAGE_MAX = 5000;
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export class ReplyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '').slice(0, max + 1);

/** Validate the draft. Throws ReplyError(400) with a message HR can act on. */
export function validateReply({ key, subject, message }) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new ReplyError(400, 'Missing or invalid reply key. Reload the page and try again.');
  const s = clean(subject, SUBJECT_MAX);
  const m = clean(message, MESSAGE_MAX);
  if (!s) throw new ReplyError(400, 'Please add a subject.');
  if (!m) throw new ReplyError(400, 'Please write a message.');
  if (s.length > SUBJECT_MAX) throw new ReplyError(400, `The subject is too long (${SUBJECT_MAX} characters at most).`);
  if (m.length > MESSAGE_MAX) throw new ReplyError(400, `The message is too long (${MESSAGE_MAX} characters at most).`);
  return { key, subject: s, message: m };
}

/**
 * @param {Object} p
 * @param {string} p.applicationId
 * @param {{key:string, subject:string, message:string}} p.draft
 * @param {{_id:any, name?:string}} p.user - the admin sending it
 * @returns {Promise<{ outcome: 'sent'|'failed'|'duplicate', reply: Object, replies: Object[] }>}
 */
export async function sendCareersReply({ applicationId, draft, user }) {
  const { key, subject, message } = validateReply(draft);

  const app = await jobApplicationRepository.findById(applicationId).select('email replies').lean();
  if (!app) throw new ReplyError(404, 'Application not found');

  const entry = {
    key, subject, text: message, to: app.email,
    sentBy: user?._id || null,
    sentByName: String(user?.name || user?.email || '').slice(0, 160),
    status: 'sending',
    createdAt: new Date(),
  };

  const claimed = await jobApplicationRepository.claimReply(applicationId, entry);
  if (!claimed) {
    // Lost the claim: either this draft was already submitted, or the cap is hit.
    const fresh = await jobApplicationRepository.findById(applicationId).select('replies').lean();
    const existing = fresh?.replies?.find((r) => r.key === key);
    if (existing) {
      log(`duplicate submit for ${applicationId} (key ${key}, ${existing.status}) — not re-sent`);
      return { outcome: 'duplicate', reply: existing, replies: fresh.replies };
    }
    if (!fresh) throw new ReplyError(404, 'Application not found');
    throw new ReplyError(409, `This application already has ${REPLY_LIMIT} replies. Email the applicant directly from the careers inbox.`);
  }

  let result;
  try {
    result = await emailHandler.sendCareersReply({ to: app.email, subject, message });
  } catch (err) {
    result = { success: false, error: err?.message || 'Unexpected error while sending' };
  }

  if (result?.success) {
    const settled = await jobApplicationRepository.settleReply(applicationId, key, {
      status: 'sent', sentAt: new Date(), messageId: String(result.messageId || ''), error: '',
    });
    log(`SENT for ${applicationId} by ${user?._id || 'unknown'} (messageId=${result.messageId || 'n/a'})`);
    return { outcome: 'sent', reply: settled.replies.find((r) => r.key === key), replies: settled.replies };
  }

  const reason = result?.fallbackToConsole
    ? 'Email sending is switched off on this server, so nothing was sent.'
    : `The email could not be sent: ${result?.error || 'unknown error'}`;
  const settled = await jobApplicationRepository.settleReply(applicationId, key, {
    status: 'failed', error: reason.slice(0, 500),
  });
  warn(`FAILED for ${applicationId} → ${result?.error || 'disabled'}`);
  return { outcome: 'failed', reply: settled.replies.find((r) => r.key === key), replies: settled.replies };
}

export default { sendCareersReply, validateReply };
