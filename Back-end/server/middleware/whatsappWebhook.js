/**
 * Meta WhatsApp webhook — /api/v1/webhooks/whatsapp
 *
 * Mounted in app.js with express.raw() BEFORE csrfProtection and the JSON parser, for
 * the same two reasons as the Razorpay webhook: the signature is over the exact bytes
 * Meta sent, and a server-to-server call carries no CSRF token.
 *
 *   GET  — Meta's one-time subscribe handshake. Echo `hub.challenge` only when
 *          `hub.verify_token` matches WHATSAPP_VERIFY_TOKEN; otherwise 403.
 *   POST — events. `X-Hub-Signature-256` must equal "sha256=" + HMAC-SHA256(raw body,
 *          WHATSAPP_APP_SECRET), compared in constant time. A missing or wrong
 *          signature is 401 and an unconfigured secret is 503 — NEVER 200, so a forged
 *          request cannot pass for a delivered one.
 *
 * What a POST does: each `statuses[]` entry (sent / delivered / read / failed) moves
 * the matching NotificationLog row forward — never backwards (see
 * notificationLogRepository.advanceDeliveryStatus). Customer replies (`messages[]`)
 * are counted and dropped: there is no WhatsApp inbox, and the templates never ask
 * anyone to reply. Message content is never logged.
 */

import crypto from 'crypto';
import notificationLogRepository from '../repositories/notificationLogRepository.js';

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

/** Constant-time string compare that is safe for unequal lengths. */
const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

/**
 * @param {Buffer} rawBody
 * @param {string|undefined} header - X-Hub-Signature-256
 * @param {string} secret
 * @returns {boolean}
 */
export function isValidSignature(rawBody, header, secret) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}

/** Pull every delivery status out of a webhook payload. */
export function extractStatuses(payload) {
  const out = [];
  let replies = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      replies += Array.isArray(value.messages) ? value.messages.length : 0;
      for (const st of value.statuses || []) {
        if (!st?.id || !STATUSES.has(st.status)) continue;
        const seconds = Number(st.timestamp);
        out.push({
          id: String(st.id),
          status: st.status,
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          error: st.errors?.[0] ? `${st.errors[0].code ?? ''} ${st.errors[0].title || st.errors[0].message || ''}`.trim() : null,
        });
      }
    }
  }
  return { statuses: out, replies };
}

function handleVerify(req, res) {
  const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (expected && mode === 'subscribe' && typeof token === 'string' && safeEqual(token, expected)
      && typeof challenge === 'string') {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.status(403).send('Forbidden');
}

async function handleEvent(req, res) {
  const secret = String(process.env.WHATSAPP_APP_SECRET || '');
  if (!secret) {
    console.warn('[WhatsAppWebhook] WHATSAPP_APP_SECRET not set — rejecting event');
    return res.status(503).json({ success: false, message: 'Not configured' });
  }
  if (!isValidSignature(req.body, req.get('x-hub-signature-256'), secret)) {
    console.warn('[WhatsAppWebhook] Invalid or missing signature — rejected');
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  const { statuses, replies } = extractStatuses(payload);
  if (replies) console.log(`[WhatsAppWebhook] ${replies} customer repl${replies === 1 ? 'y' : 'ies'} received (no inbox — not stored)`);

  try {
    for (const st of statuses) {
      await notificationLogRepository.advanceDeliveryStatus(st.id, st.status, st.at, st.error);
      if (st.status === 'failed') {
        console.warn(`[WhatsAppWebhook] Message ${st.id} failed: ${st.error || 'no reason given'}`);
      }
    }
  } catch (err) {
    // A database blip: answer 500 so Meta retries the event. Re-applying is safe —
    // statuses only move forward.
    console.error('[WhatsAppWebhook] Failed to apply statuses:', err.message);
    return res.status(500).json({ success: false });
  }

  return res.status(200).json({ success: true });
}

export default function whatsappWebhook(req, res, next) {
  if (req.method === 'GET') return handleVerify(req, res);
  if (req.method === 'POST') return handleEvent(req, res).catch(next);
  return res.status(405).set('Allow', 'GET, POST').send('Method Not Allowed');
}
