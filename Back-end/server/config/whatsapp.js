/**
 * WhatsApp (Meta Cloud API) configuration — read from env on every call, so turning
 * the channel on or off is a Railway variable change plus a restart.
 *
 * The channel is OFF unless both WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are
 * set. Off means: nothing is queued, nothing is sent, one warning is logged per
 * process — and the order emails are untouched. A missing variable must never crash
 * a worker or delay an email.
 *
 * Secrets (the access token, the app secret, the verify token) are only ever read
 * here and passed to the client/webhook; nothing logs them.
 */

/** Our order event → the env var naming its approved Meta template, and its default name. */
export const TEMPLATE_ENV = {
  confirmed: ['WHATSAPP_TEMPLATE_ORDER_CONFIRMED', 'order_confirmed'],
  shipped: ['WHATSAPP_TEMPLATE_ORDER_SHIPPED', 'order_shipped'],
  out_for_delivery: ['WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY', 'order_out_for_delivery'],
  delivery_failed: ['WHATSAPP_TEMPLATE_DELIVERY_FAILED', 'order_delivery_failed'],
  delivered: ['WHATSAPP_TEMPLATE_ORDER_DELIVERED', 'order_delivered'],
  cancelled: ['WHATSAPP_TEMPLATE_ORDER_CANCELLED', 'order_cancelled'],
  payment_failed: ['WHATSAPP_TEMPLATE_PAYMENT_FAILED', 'payment_failed'],
  refund_initiated: ['WHATSAPP_TEMPLATE_REFUND_STARTED', 'refund_started'],
  refunded: ['WHATSAPP_TEMPLATE_REFUND_PROCESSED', 'refund_processed'],
};

const DEFAULT_GRAPH_VERSION = 'v23.0';

let warnedOff = false;

/** Parse WHATSAPP_TEST_RECIPIENTS ("+9198…, 98…") into a Set of E.164 numbers, or null. */
const parseAllowlist = (raw, toE164) => {
  const list = String(raw || '')
    .split(',')
    .map((s) => toE164(s.trim()))
    .filter(Boolean);
  return list.length ? new Set(list) : null;
};

/**
 * The sending config, or null when the channel is off.
 * @param {(phone: string) => string|null} toE164 - number normaliser (utils/identity.toE164India)
 * @returns {null | {
 *   phoneNumberId: string, accessToken: string, graphVersion: string,
 *   language: string, templates: Record<string,string>, testRecipients: Set<string>|null
 * }}
 */
export function getWhatsAppConfig(toE164) {
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!phoneNumberId || !accessToken) {
    if (!warnedOff) {
      warnedOff = true;
      console.warn('[WhatsApp] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set — WhatsApp order updates are OFF (emails unaffected)');
    }
    return null;
  }
  const templates = {};
  for (const [event, [envName, fallback]] of Object.entries(TEMPLATE_ENV)) {
    templates[event] = String(process.env[envName] || '').trim() || fallback;
  }
  return {
    phoneNumberId,
    accessToken,
    graphVersion: String(process.env.WHATSAPP_GRAPH_VERSION || '').trim() || DEFAULT_GRAPH_VERSION,
    language: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || '').trim() || 'en',
    templates,
    // While on Meta's test number, only these numbers can receive. Set it and every
    // other customer is skipped quietly instead of failing at Meta.
    testRecipients: toE164 ? parseAllowlist(process.env.WHATSAPP_TEST_RECIPIENTS, toE164) : null,
  };
}

/** For tests: forget that the "channel is off" warning was already logged. */
export function _resetWhatsAppWarning() {
  warnedOff = false;
}

export default { getWhatsAppConfig, TEMPLATE_ENV };
