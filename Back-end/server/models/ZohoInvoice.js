import mongoose from 'mongoose';
import { ZOHO_MATCH_STATES, ZOHO_MATCH_BY } from '../config/companyRevenue.js';

/**
 * One Zoho Books sales invoice, imported from Zoho's "Sales → Invoices → Export"
 * CSV so the admin header can show the company's full revenue, not only the
 * website's. See config/companyRevenue.js for the count-once rule.
 *
 * Its own collection, NOT an Order or a PastSale:
 *   - Order is the website's immutable financial record; ~85 files read it.
 *   - PastSale is a salesman's own past sale and feeds their sales totals; an
 *     accounting import must not credit anyone.
 *
 * Money is rupees exactly as on the Zoho invoice. Re-importing the same export
 * updates the row (status / balance can change) — `zohoInvoiceId` is unique.
 * Customer names are kept only to show the admin why two sales were matched.
 */

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String },
    action: { type: String, enum: ['imported', 'updated', 'matched'], required: true },
    note: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const ZohoInvoiceSchema = new mongoose.Schema(
  {
    zohoInvoiceId: { type: String, required: true, maxlength: 40 },
    invoiceNumber: { type: String, required: true, maxlength: 60 },
    invoiceDate: { type: Date, required: true },
    // Lower-case Zoho status ("closed", "overdue", …). Draft / void rows are never stored.
    status: { type: String, required: true, maxlength: 30 },
    customerName: { type: String, maxlength: 200 },
    customerKey: { type: String, maxlength: 200 },
    subTotal: { type: Number, required: true, min: 0 }, // ex-GST
    total: { type: Number, required: true, min: 0 }, // incl. GST — what the header adds up
    balance: { type: Number, default: 0, min: 0 }, // still unpaid
    // Zoho credit notes against this invoice (refunds / cancellations), summed from
    // models/ZohoCreditNote.js. Counted revenue is total − credited.
    credited: { type: Number, default: 0, min: 0 },
    creditedExGst: { type: Number, default: 0, min: 0 },
    reference: { type: String, maxlength: 200 },

    match: {
      state: { type: String, enum: ZOHO_MATCH_STATES, required: true, default: 'zoho_only' },
      by: { type: String, enum: ZOHO_MATCH_BY, default: 'auto' },
      order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
      reason: { type: String, maxlength: 200 },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      decidedAt: { type: Date, default: null },
    },

    batchId: { type: String, maxlength: 40 },
    importedAt: { type: Date },
    importedByName: { type: String, maxlength: 120 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

// Same names and options as config/db.js ensureCriticalIndexes (prod runs autoIndex: false).
ZohoInvoiceSchema.index({ zohoInvoiceId: 1 }, { unique: true, name: 'zoho_invoice_id' });
ZohoInvoiceSchema.index({ invoiceDate: 1, 'match.state': 1 }, { name: 'zoho_invoice_date_state' });
ZohoInvoiceSchema.index({ 'match.state': 1, invoiceDate: -1, _id: -1 }, { name: 'zoho_invoice_state_recent' });
ZohoInvoiceSchema.index({ invoiceNumber: 1 }, { name: 'zoho_invoice_number' });

export default mongoose.models.ZohoInvoice || mongoose.model('ZohoInvoice', ZohoInvoiceSchema);
