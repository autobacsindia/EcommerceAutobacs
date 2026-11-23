/**
 * Supplier-portal emails. All mail goes through services/emailHandler.js
 * (ZeptoMail) — never a provider directly. Transactional only.
 *
 * Codes are never logged. A failed send is logged (no code, no address) and
 * reported to the caller, which decides what the supplier sees.
 */
import emailHandler from '../emailHandler.js';
import userRepository from '../../repositories/userRepository.js';
import { STAFF_TEAMS } from '../../config/staff.js';

const APP = 'Autobacs Partner';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COPY = {
  verify: {
    subject: `${APP}: your email code`,
    lead: 'Enter this code in the app to confirm your email:',
  },
  reset: {
    subject: `${APP}: code to reset your password`,
    lead: 'Enter this code in the app to set a new password:',
  },
};

/** @returns {Promise<boolean>} whether the email was accepted for delivery */
export async function sendCodeEmail({ to, name, code, purpose }) {
  const copy = COPY[purpose];
  const text = `Hello ${name || ''},\n\n${copy.lead}\n\n${code}\n\nThe code works for 15 minutes. `
    + 'If you did not ask for it, you can ignore this email.\n\n— Autobacs India';
  const html = `<p>Hello ${esc(name)},</p><p>${esc(copy.lead)}</p>`
    + `<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${esc(code)}</p>`
    + '<p>The code works for 15 minutes. If you did not ask for it, you can ignore this email.</p><p>— Autobacs India</p>';
  try {
    const res = await emailHandler.sendEmail({ to, subject: copy.subject, text, html, purpose: `supplier-${purpose}-code` });
    if (!res?.success) console.warn(`[PARTNER] ${purpose} code email not sent: ${res?.error || 'unknown'}`);
    return Boolean(res?.success);
  } catch (err) {
    console.warn(`[PARTNER] ${purpose} code email failed: ${err.message}`);
    return false;
  }
}

/**
 * Tell procurement a supplier sent their documents. Fire-and-forget: a mail
 * outage must not undo the submit. One email per submit transition (the submit is
 * a compare-and-set, so a double tap sends once).
 */
export async function notifyProcurementAccountSubmitted(account) {
  try {
    const staff = await userRepository.findActiveStaff(STAFF_TEAMS.PROCUREMENT);
    const to = [...new Set(staff.map((s) => s.email).filter(Boolean))];
    if (!to.length) {
      console.warn('[PARTNER] no active procurement staff to tell about a supplier sign-up');
      return 0;
    }
    const subject = `New supplier waiting for approval: ${account.companyName}`;
    const text = `${account.companyName} (${account.contactName}, ${account.phone}) sent their documents in the ${APP} app.\n\n`
      + 'Open the staff panel → Procurement → Partners to check and approve them.';
    const html = `<p><b>${esc(account.companyName)}</b> (${esc(account.contactName)}, ${esc(account.phone)}) sent their documents in the ${APP} app.</p>`
      + '<p>Open the staff panel → Procurement → Partners to check and approve them.</p>';
    const results = await Promise.allSettled(to.map((addr) => emailHandler.sendEmail({ to: addr, subject, text, html, purpose: 'supplier-submitted' })));
    const sent = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
    if (sent < to.length) console.warn(`[PARTNER] procurement notice sent to ${sent}/${to.length}`);
    return sent;
  } catch (err) {
    console.warn(`[PARTNER] procurement notice failed: ${err.message}`);
    return 0;
  }
}
