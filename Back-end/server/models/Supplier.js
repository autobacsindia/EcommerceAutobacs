import mongoose from 'mongoose';
import { encryptField } from '../utils/fieldEncryption.js';

/**
 * A supplier procurement buys from — saved once, picked from a list when a
 * supplier payment is raised (services/supplierService.js).
 *
 *   • The bank account number is encrypted at rest (FIELD_ENCRYPTION_KEY) and
 *     never selected by default; `payment.accountLast4` is what lists show.
 *   • A payment request COPIES these details when it is raised, so editing a
 *     supplier never rewrites what was already paid.
 *   • Changing where the money goes (method, UPI, account, IFSC) stamps
 *     `bankChangedAt` / `bankChangedByName`; payments raised soon after carry a
 *     warning to accounts and the admin — the usual shape of supplier fraud.
 *   • Never deleted (payments point here); `active: false` hides it from the picker.
 */
const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Lower-cased, single-spaced name: duplicates and prefix search.
    nameKey: { type: String, required: true },
    contactPerson: { type: String, default: '', maxlength: 120 },
    phone: { type: String, default: '', maxlength: 20 },
    email: { type: String, default: '', maxlength: 160 },
    gstin: { type: String, default: '', maxlength: 15 },
    address: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 1000 },

    payment: {
      method: { type: String, enum: ['bank', 'upi'], required: true },
      upiId: { type: String, default: '', maxlength: 100 },
      accountName: { type: String, default: '', maxlength: 120 },
      accountNumber: { type: String, default: '', select: false, set: encryptField },
      accountLast4: { type: String, default: '', maxlength: 4 },
      ifsc: { type: String, default: '', maxlength: 11 },
      bankName: { type: String, default: '', maxlength: 120 },
    },

    active: { type: Boolean, default: true },
    bankChangedAt: { type: Date, default: null },
    bankChangedByName: { type: String, default: '' },
    createdByName: { type: String, default: '' },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

SupplierSchema.index({ nameKey: 1 }, { unique: true, name: 'supplier_name' });
// The picker: active suppliers by name (keyset on nameKey).
SupplierSchema.index({ active: 1, nameKey: 1 }, { name: 'supplier_active_name' });

export default mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema);
