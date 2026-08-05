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
 * 2. **A dedicated Postmark message stream.** A shared support inbox attracts
 *    spam complaints and replies to compromised addresses. Isolating the stream
 *    means a support-mail reputation problem cannot degrade delivery of order
 *    confirmations and invoices, which are the mails that must never fail.
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
import messageRepository from '../repositories/supportMessageRepository.js';
import { REPLY_SENTINEL } from './supportSanitizer.js';

/** Postmark stream for support conversations. Falls back to the default stream. */
const stream = () => process.env.POSTMARK_SUPPORT_STREAM || process.env.POSTMARK_MESSAGE_STREAM || 'outbound';

/** The public support address customers see and reply to. */
const supportAddress = () =>
  process.env.SUPPORT_EMAIL || companyInfo.email || 'support@autobacsindia.com';

const supportName = () => process.env.SUPPORT_FROM_NAME || `${companyInfo.name} Support`;

const appUrl = () => (process.env.FRONTEND_URL || 'https://autobacsindia.com').replace(/\/$/, '');

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
 * @returns {Promise<{ sent: boolean, reason?: string, messageId?: string }>}
 */
const send = async ({
  ticket,
  subject,
  text,
  html,
  author = {},
  automated = false,
  record = true,
}) => {
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
    messageStream: stream(),
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

  if (record) {
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
      providerStream: stream(),
    });
  }

  if (!result?.success) {
    console.error(`[SupportEmail] Send failed for ${ticket.reference}: ${result?.error}`);
    return { sent: false, reason: result?.error || 'send_failed' };
  }
  return { sent: true, messageId };
};

/**
 * Acknowledge a newly opened ticket.
 *
 * Never sent in response to an auto-reply, and never for a ticket opened from
 * mail we classified as spam — both would be shouting into a void, or worse,
 * into a loop.
 */
export const sendAcknowledgement = async (ticket) => {
  const name = ticket.requester.name || 'there';
  const text = [
    `Hi ${name},`,
    '',
    `Thanks for getting in touch. We've opened ticket ${ticket.reference} and a member of our support team will reply shortly.`,
    '',
    `You can reply directly to this email and it will be added to the same ticket.`,
    '',
    `Subject: ${ticket.subject}`,
    '',
    `— ${supportName()}`,
    '',
    REPLY_SENTINEL,
  ].join('\n');

  const html = renderEmail({
    heading: 'We\'ve received your message',
    reference: ticket.reference,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">Thanks for getting in touch. We've opened ticket <strong>${escapeHtml(ticket.reference)}</strong> and a member of our support team will reply shortly.</p>
      <p style="margin:0 0 12px;">You can reply directly to this email and it will be added to the same ticket.</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">Subject: ${escapeHtml(ticket.subject)}</p>`,
    // Top-level route, matching the rest of the customer area (/orders, /profile).
    ctaLabel: 'View your tickets',
    ctaHref: `${appUrl()}/support`,
  });

  return send({
    ticket,
    subject: `We've received your message [${ticket.reference}]`,
    text,
    html,
    automated: true,
  });
};

/**
 * Send an agent's reply to the customer.
 *
 * @param {Object} ticket
 * @param {string} body - the agent's plain-text message
 * @param {Object} author - { user, name }
 */
export const sendAgentReply = async (ticket, body, author = {}) => {
  const name = ticket.requester.name || 'there';
  const signature = author.name ? `— ${author.name}, ${companyInfo.name} Support` : `— ${supportName()}`;

  const text = [`Hi ${name},`, '', body, '', signature, '', REPLY_SENTINEL].join('\n');

  const html = renderEmail({
    heading: `Re: ${ticket.subject}`,
    reference: ticket.reference,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <div style="margin:0 0 12px;white-space:pre-wrap;">${escapeHtml(body)}</div>
      <p style="margin:0;color:#6b7280;font-size:13px;">${escapeHtml(signature)}</p>`,
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
  });
};

/** Tell the customer their ticket is resolved, and how to reopen it. */
export const sendResolutionNotice = async (ticket, author = {}) => {
  const name = ticket.requester.name || 'there';
  const text = [
    `Hi ${name},`,
    '',
    `We've marked ticket ${ticket.reference} as resolved.`,
    '',
    `If this isn't sorted, just reply to this email and the ticket will reopen automatically.`,
    '',
    `— ${supportName()}`,
    '',
    REPLY_SENTINEL,
  ].join('\n');

  const html = renderEmail({
    heading: 'Your ticket is resolved',
    reference: ticket.reference,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">We've marked ticket <strong>${escapeHtml(ticket.reference)}</strong> as resolved.</p>
      <p style="margin:0 0 12px;">If this isn't sorted, just reply to this email and the ticket will reopen automatically.</p>`,
  });

  return send({ ticket, subject: `Resolved: ${threadSubject(ticket)}`, text, html, author, automated: true });
};

export default {
  buildReplyTo,
  parseReplyTo,
  sendAcknowledgement,
  sendAgentReply,
  sendResolutionNotice,
};
