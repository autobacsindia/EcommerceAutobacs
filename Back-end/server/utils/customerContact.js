/**
 * Customers with no email address.
 *
 * Every User needs a unique `email`, but a customer who calls or WhatsApps may
 * not have (or give) one. Such a customer gets an internal address derived from
 * their mobile number under the reserved `.invalid` TLD (RFC 2606) — the same
 * convention as staff company accounts (config/staff.js). Consequences:
 *   - it is deterministic, so the next order for the same mobile reuses the same
 *     customer instead of creating a duplicate;
 *   - it can never receive mail, and emailHandler refuses to send to `.invalid`,
 *     so no bounce ever hurts sender reputation;
 *   - it is never shown to a person (publicEmail) or sent to Razorpay.
 */
export const PHONE_CUSTOMER_DOMAIN = 'phone.autobacs.invalid';

const MOBILE = /^[6-9]\d{9}$/;

/** The internal address for a phone-only customer. Throws on a non-mobile. */
export function phoneOnlyEmailFor(phone) {
  const p = String(phone ?? '').trim();
  if (!MOBILE.test(p)) throw new Error('A valid 10-digit mobile number is required when there is no email');
  return `m${p}@${PHONE_CUSTOMER_DOMAIN}`;
}

/** Any internal (`.invalid`) address — phone-only customers and staff company accounts. */
export const isInternalEmail = (email) => /@[^@\s]+\.invalid$/i.test(String(email ?? '').trim());

/** The address to SHOW or SEND to: '' for an internal one. */
export const publicEmail = (email) => (isInternalEmail(email) ? '' : String(email ?? ''));
