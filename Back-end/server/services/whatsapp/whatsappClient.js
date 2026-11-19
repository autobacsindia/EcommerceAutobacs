/**
 * Meta WhatsApp Cloud API — send ONE template message.
 *
 * Provider-only: no database, no idempotency, no retries. The caller
 * (orderWhatsAppService) owns "send once"; BullMQ owns retrying. A blind retry in here
 * would double-send whenever Meta accepted the message but the response was lost.
 *
 * Errors are classified so the caller knows whether a retry can help:
 *   transient  — network error, timeout, HTTP 429/5xx, or Meta's throttling codes
 *   permanent  — everything else (bad number, template not approved, bad token…)
 */

const TIMEOUT_MS = 10_000;

/** Meta error codes that mean "try again later", whatever the HTTP status. */
const TRANSIENT_META_CODES = new Set([
  1, 2, // API unknown / service temporarily unavailable
  4, 80007, 130429, 131048, 131056, // rate / pair-rate / spam-rate limits
  131000, 131016, // something went wrong / service unavailable
]);

export class WhatsAppSendError extends Error {
  /**
   * @param {string} message
   * @param {{transient: boolean, code?: number|null, httpStatus?: number|null}} info
   */
  constructor(message, { transient, code = null, httpStatus = null }) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.transient = transient;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Meta rejects a template parameter that contains a newline or tab, or more than four
 * spaces in a row, and caps its length. Flatten whitespace and bound it.
 * @param {unknown} value
 * @returns {string}
 */
export const cleanParam = (value) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * @param {object} args
 * @param {string} args.to - E.164, e.g. +919876543210
 * @param {string} args.template - approved template name
 * @param {string} args.language - template language code, e.g. 'en'
 * @param {string[]} args.params - body variables {{1}}…{{n}}, in order
 * @param {{phoneNumberId: string, accessToken: string, graphVersion: string}} cfg
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{messageId: string}>}
 * @throws {WhatsAppSendError}
 */
export async function sendTemplateMessage({ to, template, language, params }, cfg, fetchImpl = fetch) {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/^\+/, ''),
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components: [{
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: cleanParam(p) })),
      }],
    },
  };

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network failure or timeout: Meta may or may not have the message. Retrying can
    // in rare cases double-send; never retrying would silently drop many more.
    throw new WhatsAppSendError(`WhatsApp request failed: ${err.message}`, { transient: true });
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  const messageId = json?.messages?.[0]?.id;
  if (res.ok && messageId) return { messageId };

  const metaError = json?.error || {};
  const code = Number.isFinite(metaError.code) ? metaError.code : null;
  const transient = res.status === 429 || res.status >= 500 || (code != null && TRANSIENT_META_CODES.has(code));
  const detail = metaError.error_data?.details || metaError.message || `HTTP ${res.status}`;
  throw new WhatsAppSendError(
    `WhatsApp send rejected (HTTP ${res.status}${code != null ? `, code ${code}` : ''}): ${detail}`,
    { transient, code, httpStatus: res.status },
  );
}

export default { sendTemplateMessage, cleanParam, WhatsAppSendError };
