import mongoose from 'mongoose';
import { PAST_SALE_CHANNELS, PAST_SALE_PAYMENT_METHODS } from '../config/pastSale.js';

/**
 * A sale made before (or outside) the website — in the store, by phone, on
 * WhatsApp — typed in by the salesman who made it, or uploaded from their sheet.
 *
 * Its own collection, NOT an Order, on purpose:
 *   - about 85 files read Order (payment reconciliation, the procurement /
 *     delivery queues, review-request emails, invoices, refunds). A past sale
 *     must reach none of them, and a separate collection makes that structural
 *     instead of a filter every one of those paths has to remember.
 *   - an Order is an immutable financial record; a past sale is a transcription
 *     of a paper bill and is corrected (edited) and deleted (soft) by people.
 *
 * Money is stored exactly as written on the bill (rupees). Nothing is re-priced
 * from today's catalogue; a line keeps its own name even when it links a product.
 *
 * Deleting only sets `active: false` (restorable). Both uniqueness rules below
 * are scoped to active rows, so a deleted sale never blocks re-entering it.
 */

const LineSchema = new mongoose.Schema(
  {
    // Optional link to the catalogue product; the line's own name is the record.
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    name: { type: String, required: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }, // rupees per unit, as on the bill
  },
  { _id: false },
);

const ChangeSchema = new mongoose.Schema(
  { field: String, from: String, to: String },
  { _id: false },
);

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String },
    action: { type: String, enum: ['created', 'edited', 'deleted', 'restored'], required: true },
    changes: { type: [ChangeSchema], default: undefined },
  },
  { _id: false },
);

const PastSaleSchema = new mongoose.Schema(
  {
    /** The calendar day of the sale (UTC midnight of that date). */
    saleDate: { type: Date, required: true },
    /** The bill / invoice number as typed. */
    invoiceNo: { type: String, maxlength: 60 },
    /** Upper-cased, spaces / dashes / slashes removed — what uniqueness is checked on. */
    invoiceKey: { type: String },
    /**
     * Who sold it, what, when and for how much — hashed. Stops the same bill
     * without a number going in twice (a re-uploaded sheet, a double click).
     * A genuine repeat (same customer, same items, same day) is saved with an
     * explicit "save anyway", which suffixes this.
     */
    fingerprint: { type: String, required: true },
    customer: {
      name: { type: String, required: true, maxlength: 120 },
      phone: { type: String, maxlength: 20 },
      /** Last 10 digits — matches the same person however the number was written. */
      phoneKey: { type: String },
      email: { type: String, maxlength: 254 },
      city: { type: String, maxlength: 80 },
      state: { type: String, maxlength: 80 },
    },
    business: {
      type: new mongoose.Schema({ legalName: { type: String, maxlength: 160 }, gstin: { type: String } }, { _id: false }),
      default: undefined,
    },
    vehicle: { type: String, maxlength: 120 },
    channel: { type: String, enum: PAST_SALE_CHANNELS },
    items: {
      type: [LineSchema],
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'At least one item is required' },
    },
    /** Σ quantity × price, computed on save. */
    itemsTotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    gstAmount: { type: Number, min: 0 },
    /** The amount paid as written on the bill — the figure every total uses. */
    totalAmount: { type: Number, required: true, min: 0 },
    /** Items − discount ≠ total (by more than ₹1). Saved anyway: old bills are not always exact. */
    amountMismatch: { type: Boolean, default: false },
    paymentMethod: { type: String, enum: PAST_SALE_PAYMENT_METHODS, required: true },
    notes: { type: String, maxlength: 1000 },

    /** "Sold by". null = no salesman (entered by admin / accounts for a walk-in). */
    salesUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    salesUserName: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String },
    /** Set on sales that came from one spreadsheet upload, so it can be undone together. */
    batchId: { type: String },

    active: { type: Boolean, default: true, required: true },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletedByName: { type: String },

    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);

/*
  Indexes. autoIndex is off in production: each of these is ALSO built at
  startup by config/db.js ensureCriticalIndexes. Partial filters use `$type` /
  `active: true`, never `$ne` (MongoDB rejects `$ne` in a partialFilterExpression).
*/
// One bill number, one active sale.
PastSaleSchema.index(
  { invoiceKey: 1 },
  { unique: true, partialFilterExpression: { active: true, invoiceKey: { $type: 'string' } }, name: 'past_sale_invoice_active' },
);
// The same sale (no bill number) cannot go in twice.
PastSaleSchema.index(
  { fingerprint: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'past_sale_fingerprint_active' },
);
// Lists, newest sale first (keyset on saleDate/_id): everyone's, and one salesman's.
PastSaleSchema.index({ active: 1, saleDate: -1, _id: -1 }, { name: 'past_sale_recent' });
PastSaleSchema.index({ active: 1, salesUser: 1, saleDate: -1, _id: -1 }, { name: 'past_sale_by_seller' });
// A customer's past purchases, by phone.
PastSaleSchema.index(
  { 'customer.phoneKey': 1, saleDate: -1 },
  { partialFilterExpression: { 'customer.phoneKey': { $type: 'string' } }, name: 'past_sale_customer_phone' },
);
// Undo one upload.
PastSaleSchema.index({ batchId: 1 }, { partialFilterExpression: { batchId: { $type: 'string' } }, name: 'past_sale_batch' });

export default mongoose.models.PastSale || mongoose.model('PastSale', PastSaleSchema);
