import mongoose from 'mongoose';
import { encryptField } from '../utils/fieldEncryption.js';

/**
 * A supplier's LOGIN to the Autobacs Partner app — a third kind of account,
 * deliberately NOT a `User`:
 *
 *   • Staff and customers live in `users`; their `protect` middleware looks up
 *     `users` and verifies tokens with the plain JWT secret. A supplier token is
 *     signed with a domain-separated key (middleware/supplierAuth.js), so it can
 *     never pass `protect`, and a customer/staff token can never pass
 *     `protectSupplier`. No change to the existing auth path was needed.
 *   • `supplierId` links to the procurement `Supplier` record (payments, credit,
 *     enquiries). It is set when procurement approves the account — either an
 *     existing supplier we already pay, or a new one. Until then it is null.
 *   • Nothing here is ever returned to a customer. Supplier-facing views go
 *     through utils/supplierPortalView.js (allow-list), never `toObject()`.
 *
 * Status: what the supplier may do.
 *   email_unverified → signed up, has not entered the email code. Can only verify.
 *   draft            → email verified, filling in company documents.
 *   in_review        → documents sent; waiting for procurement. Read-only.
 *   changes_requested→ procurement asked for a fix (reviewNote). Can edit + resend.
 *   approved         → may list products.
 *   rejected         → final; can sign in to read the reason, nothing else.
 *   suspended        → procurement/admin paused them; listings stay as they are.
 */
export const SUPPLIER_ACCOUNT_STATUS = Object.freeze({
  EMAIL_UNVERIFIED: 'email_unverified',
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  CHANGES_REQUESTED: 'changes_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
});
export const SUPPLIER_ACCOUNT_STATUS_VALUES = Object.freeze(Object.values(SUPPLIER_ACCOUNT_STATUS));

const DocFileSchema = new mongoose.Schema(
  {
    // Private storage key (services/storage/privateUploads.js). Never a public URL.
    key: { type: String, required: true, maxlength: 300 },
    // Which store holds it — read/delete route on this, never on the key's shape
    // (services/storage/privateAssetUrl.js providerOf). Missing = cloudinary.
    provider: { type: String, enum: ['r2', 'cloudinary'] },
    contentType: { type: String, default: '', maxlength: 80 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SupplierAccountSchema = new mongoose.Schema(
  {
    // Sign-in identity. `emailKey` = trimmed lower-case email, unique.
    email: { type: String, required: true, trim: true, maxlength: 160 },
    emailKey: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    passwordHash: { type: String, required: true, select: false },

    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    city: { type: String, default: '', trim: true, maxlength: 80 },
    address: { type: String, default: '', trim: true, maxlength: 500 },

    // Documents (checked by procurement; never shown outside procurement/admin
    // and the supplier themselves).
    gstin: { type: String, default: '', trim: true, uppercase: true, maxlength: 15 },
    pan: { type: String, default: '', trim: true, uppercase: true, maxlength: 10 },
    gstCertificate: { type: DocFileSchema, default: null },
    cancelledCheque: { type: DocFileSchema, default: null },
    bank: {
      accountName: { type: String, default: '', maxlength: 120 },
      // Encrypted at rest, never selected by default — same rule as Supplier.payment.
      accountNumber: { type: String, default: '', select: false, set: encryptField },
      accountLast4: { type: String, default: '', maxlength: 4 },
      ifsc: { type: String, default: '', uppercase: true, maxlength: 11 },
      upiId: { type: String, default: '', maxlength: 100 },
    },

    status: {
      type: String,
      enum: SUPPLIER_ACCOUNT_STATUS_VALUES,
      default: SUPPLIER_ACCOUNT_STATUS.EMAIL_UNVERIFIED,
    },
    submittedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 1000 },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: '' },

    // The procurement supplier record this login acts for (set on approval).
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },

    // Instant revocation: every supplier token carries this; a mismatch is 401.
    // Bumped by logout-everywhere, password change, suspension and rejection.
    sessionVersion: { type: Number, default: 0 },

    // Email verification / password reset code — hashed, short-lived, attempt-capped.
    emailCode: {
      hash: { type: String, default: '', select: false },
      purpose: { type: String, enum: ['verify', 'reset', ''], default: '', select: false },
      expiresAt: { type: Date, default: null, select: false },
      attempts: { type: Number, default: 0, select: false },
      sentAt: { type: Date, default: null, select: false },
    },

    // Brute-force lock on password sign-in (on top of the IP rate limit).
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SupplierAccountSchema.index({ emailKey: 1 }, { unique: true, name: 'supplier_account_email' });
// Procurement queue: "waiting for approval" oldest first, keyset on (submittedAt, _id).
SupplierAccountSchema.index({ status: 1, submittedAt: 1, _id: 1 }, { name: 'supplier_account_status_submitted' });
// One login per procurement supplier record. Partial on $type (never $ne — see root CLAUDE.md).
SupplierAccountSchema.index(
  { supplierId: 1 },
  { unique: true, name: 'supplier_account_supplier', partialFilterExpression: { supplierId: { $type: 'objectId' } } }
);

export const emailKeyOf = (email) => String(email || '').trim().toLowerCase();

export default mongoose.models.SupplierAccount || mongoose.model('SupplierAccount', SupplierAccountSchema);
