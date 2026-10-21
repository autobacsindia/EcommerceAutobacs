import mongoose from 'mongoose';

/**
 * A customer paid a sales order by bank transfer (NEFT / RTGS / IMPS / UPI to the
 * company account) instead of the website or a payment link.
 *
 *   pending   — GTM recorded it with the screenshot and UTR; the order is still
 *               unpaid and its payment links have been cancelled.
 *   confirmed — accounts (or the admin) found the money in the bank; the order is paid.
 *   rejected  — not found / wrong amount; the order is unpaid again, with the reason.
 *
 * A screenshot is not money, so nothing here marks an order paid until a person
 * who can see the bank account confirms it (services/bankTransferService.js).
 *
 * Its own small collection rather than a field on Order: the "waiting for
 * accounts" list and the bell count then scan a few rows, not every order, and the
 * UTR can be unique across orders.
 */
const FileSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    provider: { type: String },
    contentType: { type: String },
    bytes: { type: Number },
    name: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String },
    action: { type: String, enum: ['recorded', 'confirmed', 'rejected'], required: true },
    note: { type: String },
  },
  { _id: false },
);

const BankTransferSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String },
    salesUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    salesUserName: { type: String },
    customer: { name: String, city: String },
    /** Rupees — always the order's full total at the time it was recorded. */
    amount: { type: Number, required: true, min: 0 },
    /** The bank's UTR / reference, as typed. */
    reference: { type: String, required: true },
    /** Upper-cased, spaces and dashes removed — what uniqueness is checked on. */
    referenceKey: { type: String, required: true },
    paidOn: { type: Date, required: true },
    note: { type: String },
    files: { type: [FileSchema], default: [] },
    status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending', required: true },
    /**
     * true while pending or confirmed. The UTR index is unique over active rows
     * only, so a REJECTED transfer (wrong UTR typed, say) does not block the right
     * one — but one real UTR can never pay two orders.
     */
    active: { type: Boolean, default: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedByName: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByName: { type: String },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);

// One real UTR pays one order. Also built at startup by config/db.js
// ensureCriticalIndexes (autoIndex is off in production). `active: true`, not
// `$ne` — MongoDB rejects `$ne` in a partialFilterExpression.
BankTransferSchema.index(
  { referenceKey: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'bank_transfer_utr_active' },
);
// The lists: newest first, by status (keyset on createdAt/_id).
BankTransferSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'bank_transfer_status_recent' });
BankTransferSchema.index({ order: 1, createdAt: -1 }, { name: 'bank_transfer_order' });

export default mongoose.models.BankTransfer || mongoose.model('BankTransfer', BankTransferSchema);
