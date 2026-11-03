/**
 * Outbound support email — acknowledgements and agent replies.
 *
 * Three things make support mail different from the rest of our transactional
 * mail, and all three live here:
 *
 * 1. **A signed reply address.** Replies must come back to the right ticket even
 *    when the customer's client strips References. We encode the ticket in the
 *    Reply-To local part along with an HMAC. Without the signature anyone could
 *    inject messages into any ticket by guessing "ABI-1042" — the reference is
 *    printed in every email and is trivially enumerable.
 *
 * 2. **Its own sender.** Support mail goes out from support@ rather than
 *    noreply@. (Under Postmark it also had its own message stream; ZeptoMail
 *    has no streams — a second Mail Agent would be the equivalent if a support
 *    reputation problem ever needs isolating from order mail.)
 *
 * 3. **Loop suppression.** Every automated message carries
 *    `Auto-Submitted: auto-generated` so well-behaved autoresponders stay quiet,
 *    and every send is gated on ticketService.claimOutboundSlot for the ones
 *    that are not well behaved.
 */

import crypto from 'crypto';
import emailHandler from './emailHandler.js';
import companyInfo from '../config/company.js';
import ticketService from './ticketService.js';
import ticketRepository from '../repositories/supportTicketRepository.js';
import { trackOrderUrl } from '../utils/storefrontUrl.js';
import messageRepository from '../repositories/supportMessageRepository.js';
import { REPLY_SENTINEL } from './supportSanitizer.js';

/** The public support address customers see and reply to. */
const supportAddress = () =>
  process.env.SUPPORT_EMAIL || companyInfo.email || 'support@autobacsindia.com';

const supportName = () => process.env.SUPPORT_FROM_NAME || `${companyInfo.name} Support`;


/**
 * Secret backing the reply-token HMAC.
 *
 * Deliberately its own variable rather than reusing JWT_SECRET: this token is
 * embedded in plaintext in every outbound email and travels through third-party
 * mail servers, so it must be rotatable without invalidating every user session.
 * Falls back to JWT_SECRET only so a missing var cannot take support mail down;
 * set SUPPORT_REPLY_SECRET in production.
 */
const replySecret = () => process.env.SUPPORT_REPLY_SECRET || process.env.JWT_SECRET || '';

/**
 * Sign a ticket reference for use in a reply address.
 * Truncated to 16 hex chars: the token guards against enumeration, not against
 * an offline attack on a high-value secret, and the local part has to stay
 * within sane length limits for mail servers.
 */
const signRef = (reference) =>
  crypto.createHmac('sha256', replySecret()).update(String(reference)).digest('hex').slice(0, 16);

/**
 * Build the plus-addressed Reply-To for a ticket:
 *   support+t.ABI-1042.9f3c1a2b8d4e5f60@autobacsindia.com
 *
 * Requires the mail domain to deliver plus-addressed mail to the same inbox —
 * Google Workspace does this by default.
 */
export const buildReplyTo = (reference) => {
  const address = supportAddress();
  const [local, domain] = address.split('@');
  if (!local || !domain) return address;
  return `${local}+t.${reference}.${signRef(reference)}@${domain}`;
};

/**
 * Recover and VERIFY a ticket reference from an inbound recipient address.
 *
 * Returns null when the address carries no token or the signature does not
 * match. A failed verification must be treated as "no token" — never as a hint
 * to trust the reference anyway.
 *
 * @param {string} address - the To/Cc address the mail was delivered to
 * @returns {string|null} the verified ticket reference
 */
export const parseReplyTo = (address = '') => {
  const match = String(address).match(/\+t\.([A-Za-z0-9-]+)\.([a-f0-9]{16})@/i);
  if (!match) return null;
  const [, reference, signature] = match;

  const expected = signRef(reference);
  const provided = signature.toLowerCase();
  // Constant-time compare; lengths are fixed by construction but guard anyway
  // because timingSafeEqual throws on a length mismatch.
  if (expected.length !== provided.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  return ok ? reference : null;
};

/** Deterministic RFC Message-ID we can match against on the way back in. */
const buildMessageId = (reference) => {
  const domain = supportAddress().split('@')[1] || 'autobacsindia.com';
  return `<${reference}.${crypto.randomBytes(12).toString('hex')}@${domain}>`;
};

const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Subject carrying the ticket reference, without doubling it on replies. */
const threadSubject = (ticket) =>
  ticket.subject.includes(ticket.reference)
    ? ticket.subject
    : `${ticket.subject} [${ticket.reference}]`;

/**
 * Branded HTML shell. The sentinel is rendered as visible text (not a comment)
 * because mail clients strip comments when quoting — and the sentinel only works
 * if it survives into the customer's reply.
 */
const renderEmail = ({ heading, bodyHtml, reference, ctaLabel, ctaHref }) => `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b08d3f;">${escapeHtml(companyInfo.name)} · Support</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827;">${escapeHtml(heading)}</h1>
      <div style="font-size:14px;color:#374151;line-height:1.6;">${bodyHtml}</div>
      ${ctaHref ? `<a href="${escapeHtml(ctaHref)}" style="display:inline-block;margin-top:24px;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:6px;">${escapeHtml(ctaLabel)}</a>` : ''}
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">Your reference is <strong>${escapeHtml(reference)}</strong> — please keep it in the subject line when replying.</p>
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;">${escapeHtml(REPLY_SENTINEL)}</p>
  </div>
</body></html>`;

/**
 * Send a message on a ticket and record it on the thread.
 *
 * Every outbound path funnels through here so the loop guard, the threading
 * headers and the message record can never be skipped by a new caller.
 *
 * @param {Object} input
 * @param {Object} input.ticket - the ticket document
 * @param {string} input.subject
 * @param {string} input.text - plain-text body
 * @param {string} input.html - HTML body
 * @param {Object} [input.author] - agent identity for the thread record
 * @param {boolean} [input.automated=false] - marks machine-generated mail
 * @param {boolean} [input.record=true] - persist a SupportMessage for this send
 * @param {string} [input.onceKey] - once-only key per ticket; a second send with
 *   the same key (a queue retry, a double-click) is skipped
 * @returns {Promise<{ sent: boolean, reason?: string, messageId?: string }>}
 * @throws when the provider rejects the send, so the BullMQ job retries — the
 *   once-only key is released first so that retry can claim it again
 */
const send = async ({
  ticket,
  subject,
  text,
  html,
  author = {},
  automated = false,
  record = true,
  onceKey = null,
}) => {
  if (onceKey && !(await ticketRepository.claimEmailKey(ticket._id, onceKey))) {
    return { sent: false, reason: 'already_sent' };
  }

  // Loop guard first: if this ticket is ping-ponging with an autoresponder we
  // must not add to it, and we must not record a message that never went out.
  const slot = await ticketService.claimOutboundSlot(ticket._id);
  if (!slot.allowed) {
    console.warn(
      `[SupportEmail] Loop guard tripped for ${ticket.reference} ` +
      `(${slot.count} sends in window) — suppressing outbound mail.`
    );
    return { sent: false, reason: 'loop_guard' };
  }

  const messageId = buildMessageId(ticket.reference);

  // Thread against the most recent message so replies nest correctly in the
  // customer's client rather than appearing as unrelated mail.
  const [latest] = await messageRepository.find(
    { ticket: ticket._id, messageId: { $ne: null } },
    { sort: { createdAt: -1 }, limit: 1 }
  );
  const references = latest?.messageId
    ? [...(latest.references || []), latest.messageId].slice(-10)
    : [];

  const result = await emailHandler.sendEmail({
    to: ticket.requester.email,
    subject,
    text,
    html,
    fromEmail: supportAddress(),
    fromName: supportName(),
    replyTo: buildReplyTo(ticket.reference),
    headers: {
      'Message-ID': messageId,
      ...(latest?.messageId && { 'In-Reply-To': latest.messageId }),
      ...(references.length && { References: references.join(' ') }),
      // Tells other autoresponders not to answer this. The other half of the
      // loop defence; the guard above catches the ones that ignore it.
      ...(automated && { 'Auto-Submitted': 'auto-generated' }),
      'X-Support-Ticket': ticket.reference,
    },
  });

  if (!result?.success) {
    console.error(`[SupportEmail] Send failed for ${ticket.reference}: ${result?.error}`);
    if (onceKey) await ticketRepository.releaseEmailKey(ticket._id, onceKey);
    throw new Error(`Support email failed for ${ticket.reference}: ${result?.error || 'send_failed'}`);
  }

  // Recorded only after the provider accepted it: the thread shows what the
  // customer actually received, and a retried failure cannot leave two copies.
  // A failed record is logged, never thrown — throwing would retry the job and
  // mail the customer a second time (the once-only key would stop it, but only
  // for keyed sends).
  if (record) {
    try {
      await ticketService.addMessage({
        ticketId: ticket._id,
        direction: 'outbound',
        visibility: 'public',
        author: {
          user: author.user || null,
          email: supportAddress(),
          name: author.name || supportName(),
          isAgent: true,
        },
        bodyText: text,
        bodyHtml: html,
        messageId,
        inReplyTo: latest?.messageId || null,
        references,
        providerMessageId: result?.messageId || null,
      });
    } catch (err) {
      console.error(`[SupportEmail] Sent ${ticket.reference} but could not record it: ${err.message}`);
    }
  }

  return { sent: true, messageId };
};

/**
 * Wording rules for every automated support email (enforced by
 * tests/unit/services/supportEmailCopy.test.js):
 *
 * - Never state a dispatch, delivery or any other date, a price, or stock. Those
 *   are facts about one order that only a person looking at that order may give —
 *   an automated "dispatched today, Monday" sent on a Sunday is exactly the
 *   promise we must never make.
 * - Link to the Track Order page (built from FRONTEND_URL) so the customer can
 *   see live status themselves.
 */
export const ACK_LINES = Object.freeze({
  heading: 'Thanks for reaching out',
  body: 'Thanks for reaching out. Our team is on it and will update you soon.',
  track: 'You can track your order any time here:',
  replyHint: 'If you want to add anything, just reply to this email.',
});

/**
 * Acknowledge a newly opened ticket — once per ticket, ever.
 *
 * Never sent in response to an auto-reply, and never for a ticket opened from
 * mail we classified as spam — both would be shouting into a void, or worse,
 * into a loop.
 */
export const sendAcknowledgement = async (ticket) => {
  const name = ticket.requester.name || 'there';
  const trackUrl = trackOrderUrl();
  const text = [
    `Hi ${name},`,
    '',
    ACK_LINES.body,
    ...(trackUrl ? ['', `${ACK_LINES.track} ${trackUrl}`] : []),
    '',
    ACK_LINES.replyHint,
    '',
    `— ${supportName()}`,
    '',
    REPLY_SENTINEL,
  ].join('\n');

  const html = renderEmail({
    heading: ACK_LINES.heading,
    reference: ticket.reference,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">${escapeHtml(ACK_LINES.body)}</p>
      ${trackUrl ? `<p style="margin:0 0 12px;">${escapeHtml(ACK_LINES.track)}</p>` : ''}
      <p style="margin:0;color:#6b7280;font-size:13px;">${escapeHtml(ACK_LINES.replyHint)}</p>`,
    ctaLabel: 'Track your order',
    ctaHref: trackUrl,
  });

  return send({
    ticket,
    subject: `We've received your message [${ticket.reference}]`,
    text,
    html,
    automated: true,
    onceKey: 'ack',
  });
};

/**
 * Send an agent's reply to the customer.
 *
 * A person wrote `body`, so it is sent as written; the Track Order link is added
 * underneath so every reply points the customer at live status rather than at a
 * promise.
 *
 * @param {Object} ticket
 * @param {string} body - the agent's plain-text message
 * @param {Object} author - { user, name }
 * @param {Object} [opts]
 * @param {string} [opts.onceKey] - e.g. `reply:<jobId>`; stops a queue retry
 *   from sending the same reply twice
 */
export const sendAgentReply = async (ticket, body, author = {}, { onceKey = null } = {}) => {
  const name = ticket.requester.name || 'there';
  const signature = author.name ? `— ${author.name}, ${companyInfo.name} Support` : `— ${supportName()}`;
  const trackUrl = trackOrderUrl();

  const text = [
    `Hi ${name},`, '', body, '',
    ...(trackUrl ? [`${ACK_LINES.track} ${trackUrl}`, ''] : []),
    signature, '', REPLY_SENTINEL,
  ].join('\n');

  const html = renderEmail({
    heading: `Re: ${ticket.subject}`,
    reference: ticket.reference,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <div style="margin:0 0 12px;white-space:pre-wrap;">${escapeHtml(body)}</div>
      <p style="margin:0;color:#6b7280;font-size:13px;">${escapeHtml(signature)}</p>`,
    ctaLabel: 'Track your order',
    ctaHref: trackUrl,
  });

  return send({
    ticket,
    subject: `Re: ${threadSubject(ticket)}`,
    text,
    html,
    author,
    // A human wrote this, so it is not Auto-Submitted — an out-of-office in
    // response is a legitimate signal, not a loop.
    automated: false,
    onceKey,
  });
};

// No "your ticket is resolved" email: the agent's reply already tells the
// customer the outcome, and a second automated message added nothing (owner
// decision, 2026-11). Resolving a ticket is now silent to the customer.

export default {
  buildReplyTo,
  parseReplyTo,
  sendAcknowledgement,
  sendAgentReply,
};
