import AppError from './AppError.js';

/**
 * Payee details for a payment (payment requests, the supplier directory):
 * checked for the shape a payment actually needs.
 */
const fail = (message, status) => new AppError(message, status, { expose: true });

export const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// SWIFT / BIC: bank (4 letters), country (2 letters), location (2), optional branch (3).
export const SWIFT = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
export const ACCOUNT = /^\d{6,18}$/;
// A foreign account: local digits, or an IBAN (letters and digits, up to 34).
export const FOREIGN_ACCOUNT = /^[A-Z0-9]{4,34}$/;

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
    // An Indian bank is found by its IFSC, a foreign one by its SWIFT code — one
    // or the other, never both (a stale IFSC beside a SWIFT would be paid wrong).
    const ifsc = String(p.ifsc || '').replace(/\s+/g, '').toUpperCase();
    const swift = String(p.swift || '').replace(/\s+/g, '').toUpperCase();
    if (ifsc && swift) throw fail('Enter the IFSC (Indian bank) or the SWIFT code (foreign bank), not both.', 400);
    const foreign = Boolean(swift);
    const accountNumber = String(p.accountNumber || '').replace(/\s+/g, '');
    const accountName = String(p.accountName || '').trim().slice(0, 120);
    if (foreign) {
      if (!FOREIGN_ACCOUNT.test(accountNumber.toUpperCase())) throw fail('Enter a valid bank account number or IBAN (4–34 letters and digits).', 400);
      if (!SWIFT.test(swift)) throw fail('Enter a valid SWIFT code: 8 or 11 letters and digits (e.g. KASITHBK).', 400);
    } else {
      if (!ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).', 400);
      if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234) — or choose SWIFT for a foreign bank.', 400);
    }
    if (accountName.length < 2) throw fail('Enter the account holder\'s name.', 400);
    Object.assign(payee, {
      accountNumber: foreign ? accountNumber.toUpperCase() : accountNumber,
      ifsc: foreign ? '' : ifsc,
      swift: foreign ? swift : '',
      accountName,
      bankName: String(p.bankName || '').trim().slice(0, 120),
    });
  }
  return payee;
}

/** "XXXXXX4321" — for lists and chat, where the full number is not needed. */
export const maskAccount = (n) => (n ? `${'X'.repeat(Math.max(0, String(n).length - 4))}${String(n).slice(-4)}` : '');

/** The bank's code as printed: "IFSC HDFC0001234" or "SWIFT KASITHBK"; '' when neither. */
export const bankCodeLabel = (p = {}) => (p.swift ? `SWIFT ${p.swift}` : p.ifsc ? `IFSC ${p.ifsc}` : '');

/**
 * Where the money goes, as one key: two payments with the same key can be paid
 * in ONE transfer. Bank: account + IFSC (or SWIFT); UPI: the UPI ID (case-insensitive).
 * A record from before SWIFT has only an IFSC, so its key is what it always was.
 * Grouping by destination rather than by name is deliberate — a name typed two
 * ways is still one account, and two suppliers sharing a name are not.
 */
export const payKeyOf = (payee = {}, ownId = '') => (payee.method === 'upi'
  // No UPI ID (paid by QR): nothing proves two such payees are one account, so
  // each stays on its own (`ownId` = the request id) and is never batched.
  ? (String(payee.upiId || '').trim() ? `upi:${String(payee.upiId).trim().toLowerCase()}` : `upi-qr:${ownId}`)
  : `bank:${String(payee.accountNumber || '').replace(/\s+/g, '')}:${String(payee.ifsc || payee.swift || '').trim().toUpperCase()}`);
