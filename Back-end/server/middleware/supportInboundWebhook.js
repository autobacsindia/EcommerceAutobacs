/**
 * Postmark inbound-email webhook.
 *
 * Mounted in app.js BEFORE csrfProtection, for the same reason as the Razorpay
 * webhook: this is a server-to-server POST carrying no cookies and no CSRF
 * token, so behind the global CSRF middleware every delivery would 403 before
 * this handler ever ran — and Postmark would eventually disable the hook,
 * silently cutting off every customer email.
 *
 * AUTHENTICATION
 * --------------
 * Postmark does not sign inbound payloads the way Razorpay signs webhooks, so
 * there is no HMAC to verify. The supported mechanisms are:
 *   1. A secret embedded in the webhook URL (Basic auth credentials), compared
 *      in constant time.
 *   2. An IP allowlist — Postmark publishes fixed outbound ranges.
 * Both are applied. Either alone is weak: a URL secret can leak into logs, and
 * IPs alone would let anyone behind the same provider post to us.
 *
 * CONTRACT WITH POSTMARK
 * ----------------------
 * Return 200 fast. Anything else is retried, so a slow or throwing handler turns
 * one email into a storm. We therefore persist the raw payload and enqueue, and
 * only return non-2xx when we genuinely want the delivery replayed (i.e. we
 * failed to durably store it).
 */

import crypto from 'crypto';
import inboundEmailService from '../services/inboundEmailService.js';
import { getNotificationsQueue } from '../queue/queues.js';

/**
 * Postmark's published inbound source ranges.
 *
 * Override with POSTMARK_INBOUND_IPS (comma-separated) rather than editing this
 * list, so a provider change is an env update and not a deploy. An empty
 * effective list disables the IP check — deliberate, so a stale hardcoded range
 * can never black-hole support mail; the URL secret still gates access.
 */
const DEFAULT_POSTMARK_IPS = [
  '3.134.147.250',
  '50.31.156.6',
  '50.31.156.77',
  '18.217.206.57',
];

const allowedIps = () => {
  const raw = process.env.POSTMARK_INBOUND_IPS;
  if (raw === undefined) return DEFAULT_POSTMARK_IPS;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
};

/** Constant-time string compare that tolerates unequal lengths. */
const safeEqual = (a = '', b = '') => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verify the shared secret supplied by Postmark.
 *
 * Accepts it either as HTTP Basic credentials (the `https://user:pass@host/...`
 * form Postmark supports in a webhook URL) or as a `?token=` query parameter.
 */
const isAuthorised = (req) => {
  const expected = process.env.POSTMARK_INBOUND_SECRET;

  // Fail CLOSED. An unset secret in production would leave an unauthenticated
  // endpoint that writes to the database open to the internet.
  if (!expected) {
    console.error('[SupportInbound] POSTMARK_INBOUND_SECRET is not set — rejecting delivery.');
    return false;
  }

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(password, expected)) return true;
  }

  if (req.query?.token && safeEqual(req.query.token, expected)) return true;

  return false;
};

/** Is the caller inside the allowed source ranges? */
const isAllowedIp = (req) => {
  const list = allowedIps();
  if (list.length === 0) return true; // check disabled by config

  // Railway terminates TLS at a proxy, so the origin IP is in X-Forwarded-For.
  // `trust proxy` is set on the app, which makes req.ip the left-most entry.
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  return list.includes(ip);
};

/**
 * Express handler. Mount with express.json() — unlike the Razorpay webhook there
 * is no signature over raw bytes, so the parsed body is what we need.
 */
const supportInboundWebhook = async (req, res) => {
  if (!isAllowedIp(req)) {
    console.warn(`[SupportInbound] Rejected delivery from disallowed IP: ${req.ip}`);
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  if (!isAuthorised(req)) {
    console.warn(`[SupportInbound] Rejected delivery with bad or missing secret from ${req.ip}`);
    return res.status(401).json({ success: false, message: 'Unauthorised' });
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    // Malformed and unrecoverable — 200 so Postmark stops retrying something
    // that will never parse.
    console.warn('[SupportInbound] Discarding non-object payload.');
    return res.status(200).json({ success: true, ignored: true });
  }

  try {
    const { id, duplicate } = await inboundEmailService.capture(payload);

    // Durably stored. Everything after this point is replayable from the stored
    // payload, so the delivery is safe to acknowledge.
    if (!duplicate && id) {
      try {
        await getNotificationsQueue().add(
          'process-inbound-email',
          { inboundId: String(id) },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
          }
        );
      } catch (queueErr) {
        // Redis is down. The raw email is already safe in Mongo and the stuck-email
        // sweep will pick it up, so we still acknowledge — asking Postmark to
        // redeliver would not help, because capture() would just dedupe it.
        console.error('[SupportInbound] Failed to enqueue processing job:', queueErr?.message);
      }
    }

    return res.status(200).json({ success: true, duplicate });
  } catch (err) {
    // We could NOT store it. This is the one case worth a retry — returning 500
    // asks Postmark to redeliver rather than losing a customer's email.
    console.error('[SupportInbound] Failed to capture inbound email:', err?.message);
    return res.status(500).json({ success: false, message: 'Capture failed' });
  }
};

export default supportInboundWebhook;
