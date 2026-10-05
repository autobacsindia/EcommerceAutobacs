/**
 * Customer-facing support contact — one place, so the floating buttons, the
 * consultation page and its thank-you page can never show different numbers.
 * (Same number the Contact page publishes.)
 */
export const SUPPORT_PHONE_DISPLAY = '+91 98952 57905';
export const SUPPORT_PHONE_TEL = '+919895257905';
const SUPPORT_WHATSAPP_NUMBER = '919895257905';

/** WhatsApp click-to-chat link with an optional pre-filled message. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
