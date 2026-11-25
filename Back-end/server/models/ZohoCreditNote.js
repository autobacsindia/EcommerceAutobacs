import mongoose from 'mongoose';

/**
 * One Zoho Books credit note (a refund / cancellation against a Zoho invoice),
 * imported from "Sales → Credit Notes → Export". Its total is taken off the
 * invoice it names (ZohoInvoice.credited), so a cancelled store sale stops
 * counting. Re-importing the same export is a no-op (unique Zoho id).
 */
const ZohoCreditNoteSchema = new mongoose.Schema(
  {
    zohoCreditNoteId: { type: String, required: true, maxlength: 40 },
    creditNoteNumber: { type: String, required: true, maxlength: 60 },
    creditNoteDate: { type: Date, required: true },
    status: { type: String, required: true, maxlength: 30 },
    invoiceNumber: { type: String, maxlength: 60 }, // "Associated Invoice Number"
    subTotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    importedAt: { type: Date },
    importedByName: { type: String, maxlength: 120 },
  },
  { timestamps: true }
);

// Same names and options as config/db.js ensureCriticalIndexes (prod runs autoIndex: false).
ZohoCreditNoteSchema.index({ zohoCreditNoteId: 1 }, { unique: true, name: 'zoho_credit_note_id' });
ZohoCreditNoteSchema.index({ invoiceNumber: 1 }, { name: 'zoho_credit_note_invoice' });

export default mongoose.models.ZohoCreditNote || mongoose.model('ZohoCreditNote', ZohoCreditNoteSchema);
