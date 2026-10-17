import mongoose from 'mongoose';
import { encryptField } from '../utils/fieldEncryption.js';

/**
 * A customer's bank account, saved by the GTM / accounts team for REFUNDS and NEFT
 * transfers — so the next order (or the next refund) does not need it typed again.
 *
 * ── WHAT IS NEVER HERE ───────────────────────────────────────────────────────────
 * Card numbers, CVV, expiry, UPI PINs. Card data may not be stored outside a PCI-DSS
 * certified vault (and RBI's card-on-file rules forbid merchants keeping it at all);
 * customers pay by card on Razorpay's page, which never hands the number to us. This
 * model has no field that could hold one, and the service accepts only the fields below.
 *
 * ── HOW IT IS PROTECTED ──────────────────────────────────────────────────────────
 *   accountNumber  AES-256-GCM via utils/fieldEncryption (FIELD_ENCRYPTION_KEY, which
 *                  lives in the app environment, never in Mongo); `select: false`, so no
 *                  query returns it unless it asks by name
 *   accountLast4   what every screen shows (XXXXXXXX1234)
 *
 * Only accounts and admin can see the full number, and every reveal is audit-logged
 * (services/customerBankService.js).
 *
 * Keyed by the customer's 10-digit mobile — the one thing every GTM quotation and
 * order carries — so details saved on one quotation appear on that customer's
 * next quotation and order. One account per customer: saving again replaces it.
 */
const CustomerBankAccountSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, match: /^[6-9]\d{9}$/ },
    accountName: { type: String, required: true, trim: true, maxlength: 120 },
    accountNumber: { type: String, required: true, select: false, set: encryptField },
    accountLast4: { type: String, required: true, match: /^\d{4}$/ },
    ifsc: { type: String, required: true, uppercase: true, match: /^[A-Z]{4}0[A-Z0-9]{6}$/ },
    bankName: { type: String, trim: true, maxlength: 120, default: '' },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    savedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

CustomerBankAccountSchema.index({ phone: 1 }, { unique: true, name: 'customer_bank_phone' });

export default mongoose.models.CustomerBankAccount
  || mongoose.model('CustomerBankAccount', CustomerBankAccountSchema);
