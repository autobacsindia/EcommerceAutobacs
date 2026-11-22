import mongoose from 'mongoose';
import { SlipReadSchema } from './shared/slipReadSchema.js';

/**
 * Supplier credit — one row per thing that changed what a supplier owes us
 * (services/supplierLedgerService.js). Owner's example:
 *
 *   order cancelled after we paid the supplier ₹30,000   refund_due       +30,000
 *   the supplier pays back ₹15,000 (10 Nov, UTR …)        repaid           −15,000
 *   next order ₹40,000: ₹15,000 of it from credit         credit_used      −15,000  → we transfer ₹25,000
 *   that payment declined → the credit comes back         credit_restored  +15,000
 *   the admin gives up on what is left                    written_off      − …
 *   an approved ₹30,000 refund should have been ₹25,000   correction_down   −5,000  (correctionOf → that row)
 *   supplier issues a ₹5,000 credit note (Suppliers tab)  credit_given      +5,000
 *   a balance that is off, put right (Suppliers tab)      adjustment_up / adjustment_down ±
 *
 * What the supplier owes = Σ APPROVED rows (+ for refund_due / credit_restored,
 * − for the rest), per currency — always worked out on the server, never stored as
 * an editable number. Rows are never edited or deleted: a mistake is corrected by a
 * new row — a correction_up / correction_down linked to it (`correctionOf`), which
 * accounts approves like any other. Only `status` (pending → approved / declined /
 * cancelled) and the decision fields change, once, by compare-and-set — plus, with a
 * reason recorded in `edits`, the details of a PENDING row (owner, 2026-11-19) and the
 * note / reference of an approved one (never its money).
 *
 * Amounts are hundredths of `currency` (paise, satang, cents) as integers, so sums
 * never drift the way floats do.
 */
export const LEDGER_KINDS = Object.freeze([
  'refund_due', 'repaid', 'credit_used', 'credit_restored', 'written_off', 'correction_up', 'correction_down',
  // Added straight from the Suppliers tab, not tied to a cancelled payment (owner, 2026-11-21).
  'credit_given', 'adjustment_up', 'adjustment_down',
]);
/** +1: the supplier owes us more; −1: less. */
export const LEDGER_SIGN = Object.freeze({
  refund_due: 1, credit_restored: 1, correction_up: 1, credit_given: 1, adjustment_up: 1,
  repaid: -1, credit_used: -1, written_off: -1, correction_down: -1, adjustment_down: -1,
});
/** The kinds that add to what the supplier owes (the balance aggregate reads this). */
export const OWES_MORE_KINDS = Object.freeze(LEDGER_KINDS.filter((k) => LEDGER_SIGN[k] > 0));

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

/** One field of an edit: what it was → what it became (as shown to people). */
const ChangeSchema = new mongoose.Schema(
  { field: { type: String, required: true }, from: { type: String, default: '' }, to: { type: String, default: '' } },
  { _id: false }
);
/** Who changed the row, when, why, and what — never overwritten. */
const EditSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    reason: { type: String, required: true, maxlength: 1000 },
    changes: { type: [ChangeSchema], default: [] },
    // The browser's id for that submit: a double-clicked edit is saved once.
    formKey: { type: String, default: '' },
  },
  { _id: false }
);

/** How a supplier gave money back (a refund recorded from the order page). */
export const REFUND_METHODS = Object.freeze(['upi', 'bank', 'cash', 'credit_note']);

/** A proof file (UPI screenshot, bank statement, credit note) — stored privately, streamed through us. */
const FileSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    provider: { type: String, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    name: { type: String, default: '', maxlength: 200 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
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
      `writeoff:<form key>`, `fix:<form key>` (a correction). A declined / cancelled claim gets its key retired
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
    // A repayment recorded on the order ("Supplier refunded"): how it came back, and
    // its proof. `paymentRequest` then names the paid supplier payment it refunds.
    method: { type: String, enum: [...REFUND_METHODS, ''], default: '' },
    files: { type: [FileSchema], default: [] },
    // An entry added on the Suppliers tab may name the supplier payment it is about —
    // for people to follow only. It is NOT `paymentRequest` (that ties a row to a
    // payment's refund claim and its checks).
    link: {
      paymentRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', default: null },
      paymentRequestNumber: { type: String, default: '' },
      order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
      orderNumber: { type: String, default: '' },
    },
    // Which of reference / date / amount were read from the slip vs typed (shared/slipReadSchema.js).
    slipRead: { type: SlipReadSchema, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },
    history: { type: [HistorySchema], default: [] },

    // A correction: the approved row it corrects (its kind kept for the label).
    correctionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierLedgerEntry', default: null },
    correctionOfKind: { type: String, default: '' },
    // Bumped by every edit: an approval or edit names the version it saw, so nobody
    // approves an amount that changed under them. Rows from before 2026-11-19 have none (= 0).
    rev: { type: Number, default: 0 },
    edits: { type: [EditSchema], default: [] },
  },
  { timestamps: true }
);

SupplierLedgerEntrySchema.index({ key: 1 }, { unique: true, name: 'supplier_ledger_key' });
// A supplier's history, newest first (keyset on createdAt, _id) — and its balance.
SupplierLedgerEntrySchema.index({ supplier: 1, createdAt: -1, _id: -1 }, { name: 'supplier_ledger_supplier' });
// Accounts' queue (pending) and the report (by date), newest first.
SupplierLedgerEntrySchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'supplier_ledger_status' });
// The slip reader's duplicate-UTR check on supplier refunds (else a scan of the ledger). Only rows with a reference.
SupplierLedgerEntrySchema.index(
  { reference: 1 },
  { name: 'supplier_ledger_reference', partialFilterExpression: { reference: { $gt: '' } } }
);
// The claim on a payment (order page, refund button).
SupplierLedgerEntrySchema.index(
  { paymentRequest: 1, kind: 1 },
  { name: 'supplier_ledger_request', partialFilterExpression: { paymentRequest: { $type: 'objectId' } } }
);

export default mongoose.models.SupplierLedgerEntry || mongoose.model('SupplierLedgerEntry', SupplierLedgerEntrySchema, 'supplier_ledger');
