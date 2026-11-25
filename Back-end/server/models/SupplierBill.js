import mongoose from 'mongoose';

/**
 * A supplier bill we pay later — "We owe suppliers" (owner, 2026-11-24).
 *
 *   RK New Popular sends bill 4471 for ₹26,000, due 10 Dec. Procurement adds it
 *   here; when it is time, "Pay" raises an ordinary supplier payment request for
 *   all or part of it, which accounts approves and the admin pays (one transfer
 *   with that supplier's other payments, via payBatch).
 *
 * The money is the payment requests that point at the bill (PaymentRequest.supplierBill)
 * — paid / waiting / left are worked out from them (services/supplierBillService.js).
 * Two sums are stored:
 *   - `reservedPaise` is a LOCK, exactly like SupplierDeal's: the total of the live
 *     (not declined / cancelled) requests on the bill, moved with a conditional
 *     $inc, so two people paying at the same moment cannot together ask for more
 *     than the bill.
 *   - `paidPaise` / `settled` are a cache for the list ("still owed" vs "paid"),
 *     re-computed from the requests (never incremented), so re-running it is safe.
 *
 * Rupees only for now (owner pick, 2026-11-24): integers in paise, no drift.
 * Never deleted — a bill added by mistake is cancelled while nothing is asked for.
 */
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

const FileSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    provider: { type: String, default: '' },
    contentType: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    name: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const SupplierBillSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // SB-0001

    // Always a saved supplier: that is what puts its payments under the supplier.
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true, maxlength: 120 },

    // The supplier's own bill / invoice number as printed, and a folded copy for the
    // one-open-bill-per-number rule ("INV 4471" and "inv-4471" are the same bill).
    // Optional (owner, 2026-11-25: goods often arrive before the bill does). With no
    // number both fields are ABSENT, never '' — so the unique index below skips them.
    billNumber: { type: String, maxlength: 60 },
    billKey: { type: String, maxlength: 60 },
    // 'YYYY-MM-DD' calendar days (no time zone to get wrong).
    billDate: { type: String, default: '' },
    // Optional (owner, 2026-11-25). No due date is stored as NO_DUE_DATE ('9999-12-31',
    // services/supplierBillService.js), never '' or missing: it is then never overdue,
    // never "due this week", sorts after every dated bill, and the existing indexes and
    // keyset cursor need no special case. The API shows it as ''.
    dueDate: { type: String, required: true },

    currency: { type: String, default: 'INR', enum: ['INR'] },
    // Optional (owner, 2026-11-25): null until the bill's amount is known. A bill with
    // no amount cannot be paid (nothing can be reserved against it) and counts in no total.
    amountPaise: { type: Number, default: null, min: 100 },
    reservedPaise: { type: Number, default: 0, min: 0 },
    paidPaise: { type: Number, default: 0, min: 0 },
    settled: { type: Boolean, default: false },
    settledAt: { type: Date, default: null },

    description: { type: String, default: '', maxlength: 2000 },
    // Optional: the customer order these goods were for.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },

    files: { type: [FileSchema], default: [] },

    // open → cancelled (only while nothing is asked for). Never deleted.
    status: { type: String, enum: ['open', 'cancelled'], default: 'open', required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    // A double-submitted "Add bill" saves one bill.
    clientId: { type: String, default: undefined, maxlength: 64 },
    rev: { type: Number, default: 0 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

// The list: still owed / paid, soonest due first (keyset on dueDate, _id).
SupplierBillSchema.index({ status: 1, settled: 1, dueDate: 1, _id: 1 }, { name: 'supplier_bill_due' });
// One supplier's bills, and the per-supplier totals.
SupplierBillSchema.index({ supplier: 1, status: 1, settled: 1, dueDate: 1 }, { name: 'supplier_bill_supplier' });
// The same supplier bill cannot be added twice while it is open — even at the same moment.
// Only bills WITH a number take part ($type, never $ne: MongoDB rejects $ne in a partial
// filter). Replaces supplier_bill_open_number, which also covered bills with no number
// (two of those would collide as null) — scripts/create-supplier-bill-indexes.js drops it.
SupplierBillSchema.index(
  { supplier: 1, billKey: 1 },
  { name: 'supplier_bill_open_bill_key', unique: true, partialFilterExpression: { status: 'open', billKey: { $type: 'string' } } }
);
SupplierBillSchema.index(
  { createdBy: 1, clientId: 1 },
  { name: 'supplier_bill_client_id', unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);
SupplierBillSchema.index({ number: 1 }, { name: 'supplier_bill_number', unique: true });
// An order's page lists the bills linked to it (supplierBillService.forOrder). Partial: most bills have no order.
SupplierBillSchema.index(
  { order: 1, createdAt: -1 },
  { name: 'supplier_bill_order', partialFilterExpression: { order: { $type: 'objectId' } } }
);

export default mongoose.models.SupplierBill || mongoose.model('SupplierBill', SupplierBillSchema);
