import mongoose from 'mongoose';
import { UNBILLED_SOURCES, UNBILLED_STATES, ZOHO_MATCH_BY } from '../config/companyRevenue.js';

/**
 * Money received for a sale that has no Zoho invoice yet ("Paid, no sale bill
 * yet" on /admin/revenue). Counted in company revenue, shown apart. The rules
 * live in config/companyRevenue.js.
 *
 * Its own collection — never an Order (the website's immutable financial
 * record) and never a ZohoInvoice (a real tax invoice). Rupees incl. GST, as
 * received.
 */
const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, maxlength: 120 },
    action: { type: String, enum: ['imported', 'added', 'matched', 'decided', 'billed', 'removed'], required: true },
    note: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const UnbilledReceiptSchema = new mongoose.Schema(
  {
    source: { type: String, enum: UNBILLED_SOURCES, required: true },
    // Zoho "CustomerPayment ID" — the re-import key. Absent on manual entries.
    zohoPaymentId: { type: String, maxlength: 40 },
    paymentNumber: { type: String, maxlength: 60 },
    zohoStatus: { type: String, maxlength: 30 }, // lower-case Zoho payment status
    receivedAt: { type: Date, required: true },
    customerName: { type: String, required: true, maxlength: 200 },
    customerKey: { type: String, maxlength: 200 },
    mode: { type: String, maxlength: 60 },
    reference: { type: String, maxlength: 200 },
    // What is counted: Zoho's Unused Amount (money not on any invoice), or the manual amount.
    amount: { type: Number, required: true, min: 0 },
    paymentTotal: { type: Number, min: 0 }, // the whole Zoho payment, for context
    proof: { type: String, maxlength: 500 }, // ClickUp link, quote number, bank ref…
    note: { type: String, maxlength: 500 },

    state: { type: String, enum: UNBILLED_STATES, required: true, default: 'open' },
    stateBy: { type: String, enum: ZOHO_MATCH_BY, default: 'auto' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null }, // the panel order it is / may be
    reason: { type: String, maxlength: 200 },
    billedAs: { type: String, maxlength: 60 }, // Zoho invoice number, once billed

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    addedByName: { type: String, maxlength: 120 },
    importedAt: { type: Date },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

// Same names and options as config/db.js ensureCriticalIndexes (prod runs autoIndex: false).
// $type (never $ne) in the partial filter — MongoDB rejects $ne there.
UnbilledReceiptSchema.index(
  { zohoPaymentId: 1 },
  { unique: true, partialFilterExpression: { zohoPaymentId: { $type: 'string' } }, name: 'unbilled_zoho_payment_id' }
);
UnbilledReceiptSchema.index({ state: 1, receivedAt: -1, _id: -1 }, { name: 'unbilled_state_recent' });
UnbilledReceiptSchema.index({ receivedAt: 1 }, { name: 'unbilled_received' });

export default mongoose.models.UnbilledReceipt || mongoose.model('UnbilledReceipt', UnbilledReceiptSchema);
