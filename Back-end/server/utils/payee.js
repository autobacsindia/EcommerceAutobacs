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

// A card is paid by the company: only which card, never its number (PCI DSS) —
// the last 4 digits, a nickname and the name on it. No full number, expiry or CVV
// is ever asked for, accepted or stored.
export const CARD_TYPES = Object.freeze({ credit: 'Credit', debit: 'Debit' });
export const CARD_NETWORKS = Object.freeze({ visa: 'Visa', mastercard: 'Mastercard', rupay: 'RuPay', amex: 'Amex' });
export const LAST4_ONLY = 'Only the last 4 digits of the card — never the full card number.';

/**
 * The card's last 4 digits: exactly 4, or '' (optional). Anything with more
 * digits is refused WITHOUT echoing it — the message never carries the value.
 */
export function cleanCardLast4(v, { required = false } = {}) {
  const raw = String(v ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length > 4) throw fail(LAST4_ONLY, 400);
  if (!raw) {
    if (required) throw fail('Enter the last 4 digits of the card.', 400);
    return '';
  }
  if (!/^\d{4}$/.test(raw)) throw fail('Enter exactly the last 4 digits of the card (e.g. 4821).', 400);
  return raw;
}

const pick = (v, list) => (Object.hasOwn(list, String(v ?? '')) ? String(v) : '');

function cleanCard(p) {
  const cardType = String(p.cardType ?? '');
  const cardNetwork = String(p.cardNetwork ?? '');
  if (cardType && !pick(cardType, CARD_TYPES)) throw fail('Choose credit or debit card.', 400);
  if (cardNetwork && !pick(cardNetwork, CARD_NETWORKS)) throw fail('Choose Visa, Mastercard, RuPay or Amex.', 400);
  return {
    cardType,
    cardNetwork,
    cardLast4: cleanCardLast4(p.cardLast4),
    cardName: String(p.cardName || '').trim().slice(0, 120),
    cardLabel: String(p.cardLabel || '').trim().slice(0, 60),
  };
}

/**
 * The payee's details, checked for the shape a payment actually needs.
 *
 * `optional` (expense requests): every detail may be blank — accounts usually
 * fills them in — and card is allowed; whatever IS typed is still checked for
 * its shape. Without it (supplier payments, the supplier directory): name,
 * UPI / bank and the bank details are required, as before.
 */
export function cleanPayee(p = {}, { optional = false } = {}) {
  // Checked first and for every method: a card number typed anywhere is refused,
  // never quietly dropped (and never stored — card fields are kept only for card).
  if (String(p.cardLast4 ?? '').replace(/\D/g, '').length > 4) throw fail(LAST4_ONLY, 400);
  const name = String(p.name || '').trim().slice(0, 120);
  if (name.length < 2 && !(optional && !name)) throw fail('Enter who is being paid.', 400);
  const allowed = optional ? ['upi', 'bank', 'card'] : ['upi', 'bank'];
  const method = allowed.includes(p.method) ? p.method : optional && !p.method ? '' : null;
  if (method === null) throw fail(optional ? 'Choose UPI, bank transfer or card.' : 'Choose UPI or bank transfer.', 400);
  const payee = { name, method, phone: String(p.phone || '').trim().slice(0, 20) };
  if (method === 'upi') {
    // Optional: a payment QR can stand in for it (checked where files are known —
    // see requireUpiOrQr in services/paymentRequestService.js).
    const upiId = String(p.upiId || '').trim();
    if (upiId && !UPI.test(upiId)) throw fail('That UPI ID does not look right (e.g. name@okaxis) — or leave it empty and attach their QR.', 400);
    payee.upiId = upiId;
  } else if (method === 'card') {
    Object.assign(payee, cleanCard(p));
  } else if (method === 'bank') {
    // An Indian bank is found by its IFSC, a foreign one by its SWIFT code — one
    // or the other, never both (a stale IFSC beside a SWIFT would be paid wrong).
    const ifsc = String(p.ifsc || '').replace(/\s+/g, '').toUpperCase();
    const swift = String(p.swift || '').replace(/\s+/g, '').toUpperCase();
    if (ifsc && swift) throw fail('Enter the IFSC (Indian bank) or the SWIFT code (foreign bank), not both.', 400);
    const foreign = Boolean(swift);
    const accountNumber = String(p.accountNumber || '').replace(/\s+/g, '');
    const accountName = String(p.accountName || '').trim().slice(0, 120);
    const need = (v) => !optional || Boolean(v);
    if (foreign) {
      if (need(accountNumber) && !FOREIGN_ACCOUNT.test(accountNumber.toUpperCase())) throw fail('Enter a valid bank account number or IBAN (4–34 letters and digits).', 400);
      if (!SWIFT.test(swift)) throw fail('Enter a valid SWIFT code: 8 or 11 letters and digits (e.g. KASITHBK).', 400);
    } else if (optional && !ifsc) {
      // No bank code yet: the account may be Indian (digits) or foreign (IBAN).
      if (accountNumber && !ACCOUNT.test(accountNumber) && !FOREIGN_ACCOUNT.test(accountNumber.toUpperCase())) {
        throw fail('Enter a valid bank account number (6–18 digits) or IBAN.', 400);
      }
    } else {
      if (need(accountNumber) && !ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).', 400);
      if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234) — or choose SWIFT for a foreign bank.', 400);
    }
    if (accountName.length < 2 && need(accountName)) throw fail('Enter the account holder\'s name.', 400);
    Object.assign(payee, {
      accountNumber: /[a-z]/i.test(accountNumber) ? accountNumber.toUpperCase() : accountNumber,
      ifsc: foreign ? '' : ifsc,
      swift: foreign ? swift : '',
      accountName,
      bankName: String(p.bankName || '').trim().slice(0, 120),
    });
  }
  return payee;
}

/** "Visa credit ••••4821 · HDFC corporate card"; '' when nothing is known. */
export const cardLabelOf = (p = {}) => {
  const what = [CARD_NETWORKS[p.cardNetwork], p.cardType ? CARD_TYPES[p.cardType]?.toLowerCase() : '', p.cardLast4 ? `••••${p.cardLast4}` : '']
    .filter(Boolean).join(' ');
  return [what, p.cardLabel].filter(Boolean).join(' · ');
};

/** "UPI" / "Bank transfer" / "Card" / '' (not chosen yet). */
export const methodLabel = (m) => ({ upi: 'UPI', bank: 'Bank transfer', card: 'Card' })[m] || '';

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
export const payKeyOf = (payee = {}, ownId = '') => (payee.method !== 'upi' && payee.method !== 'bank'
  // Card, or no method yet: paid one by one, never batched. A card's key still
  // names the card, so changing it reads as a change of payment details.
  ? (payee.method === 'card' ? `card:${payee.cardLast4 || ''}:${String(payee.cardLabel || '').toLowerCase()}:${ownId}` : `none:${ownId}`)
  : payee.method === 'upi'
  // No UPI ID (paid by QR): nothing proves two such payees are one account, so
  // each stays on its own (`ownId` = the request id) and is never batched.
  ? (String(payee.upiId || '').trim() ? `upi:${String(payee.upiId).trim().toLowerCase()}` : `upi-qr:${ownId}`)
  : `bank:${String(payee.accountNumber || '').replace(/\s+/g, '')}:${String(payee.ifsc || payee.swift || '').trim().toUpperCase()}`);
