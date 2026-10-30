/**
 * Zoho ZeptoMail transport (now marketed as "Zoho CPaaS" email).
 *
 * `sendEmail(message)` takes the message object emailHandler builds
 * (PascalCase fields — From, To, Subject, TextBody, HtmlBody, ReplyTo, Headers,
 * Attachments; inherited from Postmark, the provider until 2026-10), resolves
 * to `{ MessageID }`, and rejects with an Error carrying `statusCode` and
 * `code`. Every guarantee — redirect, careers-mailbox guard, retry/backoff,
 * retryable classification — stays in emailHandler.
 *
 * Plain fetch, no SDK: one POST with JSON is all the API needs.
 *
 * API contract (verified 2026-10-29 against the live India host — Zoho's public
 * docs no longer list per-region hosts; the account's SMTP/API page names
 * cpaas.zoho.in, and the legacy api.zeptomail.in answers identically):
 *   POST https://cpaas.zoho.in/v1.1/email
 *   Authorization: Zoho-enczapikey <Send Mail token>
 *   200/201 → { data: [{ code, message }], message: 'OK', request_id }
 *   4xx/5xx → { error: { code: 'TM_4001', message, details: [{ code, message }] } }
 */

/** India data centre — the company's Zoho account lives there (books.zoho.in). */
export const DEFAULT_ZEPTOMAIL_API_URL = 'https://cpaas.zoho.in/v1.1/email';

/**
 * Generous on purpose. A timeout is ambiguous — the mail may already be
 * accepted — and emailHandler retries timeouts, so a short value trades a slow
 * send for a duplicate one.
 */
export const DEFAULT_ZEPTOMAIL_TIMEOUT_MS = 30000;

const AUTH_SCHEME = 'Zoho-enczapikey';

/**
 * Network-level failures worth retrying. Undici (Node's fetch) reports the
 * underlying socket error on `err.cause.code`.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Zoho shows the token both bare and with the scheme prefixed (its code samples
 * include it), so accept either rather than failing on a copy-paste choice.
 */
export const buildAuthHeader = (token) => {
  const trimmed = String(token || '').trim();
  return /^zoho-enczapikey\s+/i.test(trimmed) ? trimmed : `${AUTH_SCHEME} ${trimmed}`;
};

/**
 * Split an RFC 5322 mailbox ("Autobacs India <noreply@autobacsindia.com>" or a
 * bare address) into ZeptoMail's { address, name } shape.
 */
export const parseMailbox = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*)<\s*([^<>\s]+)\s*>$/);
  if (!match) return { address: raw };
  const name = match[1].trim().replace(/^"(.*)"$/, '$1').trim();
  return name ? { address: match[2], name } : { address: match[2] };
};

/**
 * Map emailHandler's message (PascalCase fields) to a ZeptoMail payload.
 *
 * A custom `Message-ID` header is sent but NOT honoured: ZeptoMail stamps its
 * own (`<request_id@bounce-zem.autobacsindia.com>`, observed in a live send
 * 2026-10-29). In-Reply-To / Auto-Submitted do pass through. Support threading
 * therefore relies on the signed Reply-To token and the subject reference, not
 * on customers echoing a Message-ID we recorded. Open/click tracking is pinned OFF:
 * click tracking rewrites every link, which would put a tracking redirect in
 * front of password-reset and order-claim links.
 */
export const toZeptoMailPayload = (msg) => {
  const payload = {
    from: parseMailbox(msg.From),
    to: [{ email_address: parseMailbox(msg.To) }],
    subject: msg.Subject,
    track_clicks: false,
    track_opens: false,
  };

  if (msg.TextBody) payload.textbody = msg.TextBody;
  if (msg.HtmlBody) payload.htmlbody = msg.HtmlBody;
  if (msg.ReplyTo) payload.reply_to = [parseMailbox(msg.ReplyTo)];

  if (Array.isArray(msg.Headers) && msg.Headers.length > 0) {
    payload.mime_headers = Object.fromEntries(msg.Headers.map(({ Name, Value }) => [Name, Value]));
  }

  if (Array.isArray(msg.Attachments) && msg.Attachments.length > 0) {
    payload.attachments = msg.Attachments.map((a) => ({
      name: a.Name,
      content: a.Content,
      mime_type: a.ContentType,
    }));
  }

  return payload;
};

/** Pull a code + readable message out of either documented error shape. */
const describeErrorBody = (body) => {
  const err = body?.error;
  if (err && typeof err === 'object') {
    const detail = Array.isArray(err.details) ? err.details[0] : null;
    return {
      code: err.code || detail?.code,
      message: [err.message, detail?.message].filter(Boolean).join(': '),
    };
  }
  // Older documented shape: { data: { error_code, message }, message: 'error' }
  if (body?.data?.error_code) {
    return { code: body.data.error_code, message: body.data.message };
  }
  return { code: undefined, message: undefined };
};

const readJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

export class ZeptoMailClient {
  /**
   * @param {Object} options
   * @param {string} options.token - Send Mail token (with or without the scheme prefix)
   * @param {string} [options.apiUrl] - Full send endpoint; defaults to the India host
   * @param {number} [options.timeoutMs]
   * @param {Function} [options.fetchImpl] - injectable for tests; defaults to global fetch
   */
  constructor({ token, apiUrl, timeoutMs, fetchImpl } = {}) {
    if (!token || !String(token).trim()) {
      throw new Error('ZeptoMail Send Mail token is required');
    }
    this.authHeader = buildAuthHeader(token);
    this.apiUrl = apiUrl || DEFAULT_ZEPTOMAIL_API_URL;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_ZEPTOMAIL_TIMEOUT_MS;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
  }

  /**
   * Send one message. Resolves `{ MessageID }` (ZeptoMail's request_id — it
   * returns no per-message id) or rejects with `statusCode`/`code`/`retryable`.
   */
  async sendEmail(msg) {
    let res;
    try {
      res = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify(toZeptoMailPayload(msg)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
      const code = timedOut ? 'ETIMEDOUT' : (cause?.cause?.code || cause?.code);
      const error = new Error(
        timedOut
          ? `ZeptoMail request timed out after ${this.timeoutMs}ms`
          : `ZeptoMail request failed: ${cause?.cause?.message || cause?.message || 'network error'}`
      );
      error.code = code;
      error.retryable = timedOut || TRANSIENT_NETWORK_CODES.has(code);
      error.cause = cause;
      throw error;
    }

    const body = await readJson(res);

    if (res.ok) {
      // Accepted. Never treat an unreadable 2xx body as a failure — retrying an
      // accepted send is exactly how a customer gets the same invoice twice.
      return { MessageID: body?.request_id ?? null };
    }

    const { code, message } = describeErrorBody(body);
    const error = new Error(message || `ZeptoMail responded ${res.status}`);
    error.statusCode = res.status;
    error.code = code;
    throw error;
  }
}

export default ZeptoMailClient;
