import mongoose from 'mongoose';

/**
 * Supplier credit — one row per thing that changed what a supplier owes us
 * (services/supplierLedgerService.js). Owner's example:
 *
 *   order cancelled after we paid the supplier ₹30,000   refund_due       +30,000
 *   the supplier pays back ₹15,000 (10 Nov, UTR …)        repaid           −15,000
 *   next order ₹40,000: ₹15,000 of it from credit         credit_used      −15,000  → we transfer ₹25,000
 *   that payment declined → the credit comes back         credit_restored  +15,000
 *   the admin gives up on what is left                    written_off      − …
 *
 * What the supplier owes = Σ APPROVED rows (+ for refund_due / credit_restored,
 * − for the rest), per currency — always worked out on the server, never stored as
 * an editable number. Rows are never edited or deleted: a mistake is corrected by a
 * new row. Only `status` (pending → approved / declined / cancelled) and the decision
 * fields change, once, by compare-and-set.
 *
 * Amounts are hundredths of `currency` (paise, satang, cents) as integers, so sums
 * never drift the way floats do.
 */
export const LEDGER_KINDS = Object.freeze(['refund_due', 'repaid', 'credit_used', 'credit_restored', 'written_off']);
/** +1: the supplier owes us more; −1: less. */
export const LEDGER_SIGN = Object.freeze({ refund_due: 1, credit_restored: 1, repaid: -1, credit_used: -1, written_off: -1 });

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    action: { type: String, required: true },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

const SupplierLedgerEntrySchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, default: '' },
    kind: { type: String, enum: LEDGER_KINDS, required: true },
    currency: { type: String, default: 'INR', maxlength: 3 },
    amountPaise: { type: Number, required: true, min: 1 },

    // pending (waiting for accounts) → approved | declined | cancelled (by whoever raised it).
    // credit_used / credit_restored / an admin's write-off are approved when written.
    status: { type: String, enum: ['pending', 'approved', 'declined', 'cancelled'], required: true },

    /*
      Idempotency: one row per cause. `use:<request>`, `restore:<request>`,
      `due:<request>` (one live claim per paid payment), `repaid:<form key>`,
      `writeoff:<form key>`. A declined / cancelled claim gets its key retired
      (suffixed) so a corrected one can be raised.
    */
    key: { type: String, required: true },

    // What it is about.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },
    paymentRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', default: null },
    paymentRequestNumber: { type: String, default: '' },
    // A repayment: the day the money came back ('YYYY-MM-DD') and its UTR / reference.
    date: { type: String, default: '' },
    reference: { type: String, default: '', maxlength: 120 },
    note: { type: String, default: '', maxlength: 1000 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

SupplierLedgerEntrySchema.index({ key: 1 }, { unique: true, name: 'supplier_ledger_key' });
// A supplier's history, newest first (keyset on createdAt, _id) — and its balance.
SupplierLedgerEntrySchema.index({ supplier: 1, createdAt: -1, _id: -1 }, { name: 'supplier_ledger_supplier' });
// Accounts' queue (pending) and the report (by date), newest first.
SupplierLedgerEntrySchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'supplier_ledger_status' });
// The claim on a payment (order page, refund button).
SupplierLedgerEntrySchema.index(
  { paymentRequest: 1, kind: 1 },
  { name: 'supplier_ledger_request', partialFilterExpression: { paymentRequest: { $type: 'objectId' } } }
);

export default mongoose.models.SupplierLedgerEntry || mongoose.model('SupplierLedgerEntry', SupplierLedgerEntrySchema, 'supplier_ledger');
