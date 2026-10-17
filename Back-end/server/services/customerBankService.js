/**
 * Saved customer bank details (models/CustomerBankAccount.js) — for refunds and NEFT.
 *
 * Reached from a GTM quotation or an order, never by typing in a phone number: the
 * quotation/order is what proves this person deals with this customer, and it names
 * the customer's mobile, which is what the details are saved under. So nobody can
 * look up a stranger's bank by guessing numbers.
 *
 *   who                          sees            may save / replace / remove
 *   seller (own) · GTM head      XXXXXXXX1234    yes
 *   accounts                     XXXXXXXX1234    yes   + reveal the full number
 *   admin                        XXXXXXXX1234    yes   + reveal the full number
 *
 * A reveal is an explicit request (`reveal=1`), is audit-logged with who and which
 * customer, and is never cached. The number itself is never written to a log, an
 * audit entry or a chat post — only its last four digits.
 *
 * Cards: there is nowhere to put one. Only the bank fields below are read from input.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import customerBankAccountRepository from '../repositories/customerBankAccountRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import salesQuotationRepository from '../repositories/salesQuotationRepository.js';
import { decryptField, encryptField, encryptionAvailable } from '../utils/fieldEncryption.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{6,18}$/;

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isAccounts = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.ACCOUNTS;
const isSalesHead = (u) => isActiveStaff(u) && u.staff.team === STAFF_TEAMS.SALES && u.staff.isHead === true;
/** May see the whole account number. */
export const mayReveal = (u) => isAdmin(u) || isAccounts(u);

/** "+91 98765 43210" → "9876543210"; anything that is not an Indian mobile → ''. */
export function mobileOf(value) {
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(String(value ?? '').replace(/[\s\-().]/g, ''));
  return m ? m[1] : '';
}

export const maskNumber = (last4) => (last4 ? `XXXXXXXX${last4}` : '');

/** The customer behind a quotation or an order, if this person may handle their bank details. */
async function customerFor(actor, kind, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Not found.', 404);
  const sellerMay = (salesUser) => canSell(actor) && (isSalesHead(actor) || idOf(salesUser) === idOf(actor._id));

  if (kind === 'quotation') {
    const q = await salesQuotationRepository.findContact(id);
    if (!q || !(isAdmin(actor) || isAccounts(actor) || sellerMay(q.salesUser))) throw fail('Quotation not found.', 404);
    return { phone: mobileOf(q.customer?.phone), name: q.customer?.name || '' };
  }
  if (kind === 'order') {
    const o = await orderRepository.findCustomerContact(id);
    // A website order has no seller: only accounts and admin handle its refunds.
    if (!o || !(isAdmin(actor) || isAccounts(actor) || (o.salesUser && sellerMay(o.salesUser)))) throw fail('Order not found.', 404);
    return {
      phone: mobileOf(o.user?.phone) || mobileOf(o.shippingAddress?.phone),
      name: o.user?.name || o.shippingAddress?.fullName || '',
    };
  }
  throw fail('Not found.', 404);
}

function shape(doc, { full = null } = {}) {
  if (!doc) return null;
  return {
    accountName: doc.accountName,
    accountNumber: full ?? maskNumber(doc.accountLast4),
    last4: doc.accountLast4,
    ifsc: doc.ifsc,
    bankName: doc.bankName || '',
    savedBy: doc.savedByName || '',
    updatedAt: doc.updatedAt,
  };
}

/**
 * The saved account for the customer on this quotation/order — masked, or in full
 * for accounts/admin when `reveal` is asked for.
 */
export async function getBankAccount(actor, kind, id, { reveal = false } = {}, req) {
  const customer = await customerFor(actor, kind, id);
  const base = { canReveal: mayReveal(actor), canSave: true, hasMobile: !!customer.phone };
  if (!customer.phone) return { ...base, account: null };
  if (reveal && !mayReveal(actor)) throw fail('Only accounts and admin can see the full account number.', 403);

  const doc = await customerBankAccountRepository.findByPhone(customer.phone, { withNumber: reveal });
  if (!doc) return { ...base, account: null };
  if (!reveal) return { ...base, account: shape(doc) };

  auditLogger.logAction(req, 'READ_SENSITIVE', 'CustomerBankAccount', doc._id, {
    change: 'bank_number_revealed', via: kind, refId: String(id), last4: doc.accountLast4,
  });
  return { ...base, account: shape(doc, { full: decryptField(doc.accountNumber) }) };
}

/** Validate the bank fields — and only those; anything else in the body is ignored. */
function cleanInput(input = {}) {
  const accountName = String(input.accountName ?? '').trim().replace(/\s+/g, ' ');
  const accountNumber = String(input.accountNumber ?? '').replace(/[\s-]/g, '');
  const ifsc = String(input.ifsc ?? '').trim().toUpperCase();
  const bankName = String(input.bankName ?? '').trim().slice(0, 120);
  if (accountName.length < 2 || accountName.length > 120) throw fail('Enter the account holder\'s name as the bank has it.', 400);
  if (!ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).', 400);
  if (input.confirmAccountNumber !== undefined
    && String(input.confirmAccountNumber).replace(/[\s-]/g, '') !== accountNumber) {
    throw fail('The two account numbers do not match.', 400);
  }
  if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234).', 400);
  return { accountName, accountNumber, ifsc, bankName };
}

/** Save (or replace) the customer's account. Returns it masked. */
export async function saveBankAccount(actor, kind, id, input, req) {
  const customer = await customerFor(actor, kind, id);
  if (!customer.phone) throw fail('This customer has no mobile number to save the details under.', 422);
  const clean = cleanInput(input);
  if (!encryptionAvailable()) throw fail('Saving bank details is not available right now — please tell the admin.', 503);

  const update = {
    $set: {
      ...clean,
      // Encrypted here explicitly rather than trusting the schema setter to run on an
      // update; encryptField is idempotent, so the setter running too is harmless.
      accountNumber: encryptField(clean.accountNumber),
      accountLast4: clean.accountNumber.slice(-4),
      savedBy: actor._id,
      savedByName: actor.name || '',
    },
  };
  const upsert = () => customerBankAccountRepository.upsertByPhone(customer.phone, update.$set);
  // Two saves for a new customer at once: one inserts, the other hits the unique
  // phone index — and simply updates on a second try.
  const doc = await upsert().catch((err) => (err?.code === 11000 ? upsert() : Promise.reject(err)));

  auditLogger.logAction(req, 'UPDATE', 'CustomerBankAccount', doc._id, {
    change: 'customer_bank_saved', via: kind, refId: String(id), last4: doc.accountLast4, ifsc: doc.ifsc,
  });
  return { canReveal: mayReveal(actor), canSave: true, hasMobile: true, account: shape(doc) };
}

/** Forget the customer's account (they asked, or it was entered wrongly). */
export async function removeBankAccount(actor, kind, id, req) {
  const customer = await customerFor(actor, kind, id);
  if (!customer.phone) return { canReveal: mayReveal(actor), canSave: true, hasMobile: false, account: null };
  const doc = await customerBankAccountRepository.deleteByPhone(customer.phone);
  if (doc) {
    auditLogger.logAction(req, 'DELETE', 'CustomerBankAccount', doc._id, {
      change: 'customer_bank_removed', via: kind, refId: String(id), last4: doc.accountLast4,
    });
  }
  return { canReveal: mayReveal(actor), canSave: true, hasMobile: true, account: null };
}

export default { getBankAccount, saveBankAccount, removeBankAccount };
