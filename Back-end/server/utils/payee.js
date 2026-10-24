import AppError from './AppError.js';

/**
 * Payee details for a payment (payment requests, the supplier directory):
 * checked for the shape a payment actually needs.
 */
const fail = (message, status) => new AppError(message, status, { expose: true });

export const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT = /^\d{6,18}$/;

/** The payee's details, checked for the shape a payment actually needs. */
export function cleanPayee(p = {}) {
  const name = String(p.name || '').trim().slice(0, 120);
  if (name.length < 2) throw fail('Enter who is being paid.', 400);
  const method = p.method === 'bank' ? 'bank' : p.method === 'upi' ? 'upi' : null;
  if (!method) throw fail('Choose UPI or bank transfer.', 400);
  const payee = { name, method, phone: String(p.phone || '').trim().slice(0, 20) };
  if (method === 'upi') {
    // Optional: a payment QR can stand in for it (checked where files are known —
    // see requireUpiOrQr in services/paymentRequestService.js).
    const upiId = String(p.upiId || '').trim();
    if (upiId && !UPI.test(upiId)) throw fail('That UPI ID does not look right (e.g. name@okaxis) — or leave it empty and attach their QR.', 400);
    payee.upiId = upiId;
  } else {
    const accountNumber = String(p.accountNumber || '').replace(/\s+/g, '');
    const ifsc = String(p.ifsc || '').trim().toUpperCase();
    const accountName = String(p.accountName || '').trim().slice(0, 120);
    if (!ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).', 400);
    if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234).', 400);
    if (accountName.length < 2) throw fail('Enter the account holder\'s name.', 400);
    Object.assign(payee, { accountNumber, ifsc, accountName, bankName: String(p.bankName || '').trim().slice(0, 120) });
  }
  return payee;
}

/** "XXXXXX4321" — for lists and chat, where the full number is not needed. */
export const maskAccount = (n) => (n ? `${'X'.repeat(Math.max(0, String(n).length - 4))}${String(n).slice(-4)}` : '');

/**
 * Where the money goes, as one key: two payments with the same key can be paid
 * in ONE transfer. Bank: account + IFSC; UPI: the UPI ID (case-insensitive).
 * Grouping by destination rather than by name is deliberate — a name typed two
 * ways is still one account, and two suppliers sharing a name are not.
 */
export const payKeyOf = (payee = {}, ownId = '') => (payee.method === 'upi'
  // No UPI ID (paid by QR): nothing proves two such payees are one account, so
  // each stays on its own (`ownId` = the request id) and is never batched.
  ? (String(payee.upiId || '').trim() ? `upi:${String(payee.upiId).trim().toLowerCase()}` : `upi-qr:${ownId}`)
  : `bank:${String(payee.accountNumber || '').replace(/\s+/g, '')}:${String(payee.ifsc || '').trim().toUpperCase()}`);
