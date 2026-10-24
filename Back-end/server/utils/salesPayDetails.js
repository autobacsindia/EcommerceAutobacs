/**
 * The payment details a GTM lead gives a customer (Order.salesPayDetails):
 * checked here, shared by the service, the order shape and the PDF. Pure — no
 * database, no storage.
 */
import AppError from './AppError.js';
import { UPI, IFSC, ACCOUNT } from './payee.js';

const fail = (message) => new AppError(message, 400, { expose: true });

export const PAY_METHODS = Object.freeze(['bank', 'upi_qr', 'other']);
/** Above this, a QR / UPI payment is asked to come by bank transfer instead. */
export const QR_LIMIT = 50000;
export const QR_LIMIT_NOTE = 'For amounts above ₹50,000, please pay by bank transfer.';

const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Bank details: all of holder, account and IFSC, or none (bank name optional). */
function cleanBank(b = {}, { required }) {
  const accountName = text(b.accountName, 120);
  const accountNumber = String(b.accountNumber ?? '').replace(/\s+/g, '');
  const ifsc = text(b.ifsc, 11).toUpperCase();
  const bankName = text(b.bankName, 120);
  if (!required && !accountName && !accountNumber && !ifsc && !bankName) return null;
  if (accountName.length < 2) throw fail('Enter the account holder\'s name.');
  if (!ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).');
  if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234).');
  return { accountName, accountNumber, ifsc, bankName };
}

/**
 * The details from the form, checked. `hasQr` = a QR image comes with this save
 * or is already on the order (a QR payment needs one).
 * @returns {{ method, bank, upiId, note }}
 */
export function cleanPayDetails(input = {}, { hasQr = false } = {}) {
  const method = PAY_METHODS.includes(input.method) ? input.method : null;
  if (!method) throw fail('Choose how the customer pays: bank transfer, GPay / UPI QR, or other.');
  let bank = null;
  try { bank = typeof input.bank === 'string' ? JSON.parse(input.bank || '{}') : input.bank || {}; } catch { bank = {}; }
  const note = text(input.note, 500);

  if (method === 'bank') return { method, bank: cleanBank(bank, { required: true }), upiId: '', note };
  if (method === 'upi_qr') {
    if (!hasQr) throw fail('Attach the GPay / UPI QR image.');
    const upiId = text(input.upiId, 100);
    if (upiId && !UPI.test(upiId)) throw fail('That UPI ID does not look right (e.g. name@okaxis) — or leave it empty.');
    // Bank details are optional here: printed for customers paying above ₹50,000.
    return { method, bank: cleanBank(bank, { required: false }), upiId, note };
  }
  if (note.length < 3) throw fail('Say how the customer should pay (e.g. cash at the office).');
  return { method, bank: null, upiId: '', note };
}

/** For the team panel (the QR image is fetched separately, never inlined). */
export function shapePayDetails(d) {
  if (!d || !d.method) return null;
  return {
    method: d.method,
    // Named fields only: `d` may be a Mongoose document, whose spread carries internals.
    bank: d.bank && d.bank.accountNumber
      ? { accountName: d.bank.accountName || '', accountNumber: d.bank.accountNumber, ifsc: d.bank.ifsc || '', bankName: d.bank.bankName || '' }
      : null,
    upiId: d.upiId || '',
    hasQr: !!d.qr?.publicId,
    note: d.note || '',
    setBy: d.setByName || '',
    setAt: d.setAt || null,
  };
}

/** Plain-text lines for WhatsApp / chat. */
export function payDetailsLines(d, total) {
  if (!d) return [];
  const lines = [];
  const bankLines = (b) => [
    `Account name: ${b.accountName}`,
    `Account number: ${b.accountNumber}`,
    `IFSC: ${b.ifsc}`,
    ...(b.bankName ? [`Bank: ${b.bankName}`] : []),
  ];
  if (d.method === 'bank') lines.push('Pay by bank transfer (NEFT / RTGS / IMPS):', ...bankLines(d.bank));
  if (d.method === 'upi_qr') {
    lines.push(`Pay by GPay / UPI: scan the QR${d.upiId ? ` or pay to ${d.upiId}` : ''}.`);
    if (Number(total) > QR_LIMIT) lines.push(QR_LIMIT_NOTE);
    if (d.bank) lines.push('Bank transfer:', ...bankLines(d.bank));
  }
  if (d.method === 'other') lines.push(d.note);
  else if (d.note) lines.push(d.note);
  return lines;
}
