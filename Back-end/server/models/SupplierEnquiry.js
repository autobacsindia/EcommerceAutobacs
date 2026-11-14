import mongoose from 'mongoose';

/**
 * A price / availability enquiry procurement sends to suppliers on WhatsApp
 * (services/supplierEnquiryService.js). The message itself is built in the panel
 * and sent by a person through a wa.me link — nothing here sends anything.
 *
 *   • Money is whole paise (integers): `targetPaise`, a quote's `unitPaise`.
 *   • Each supplier row SNAPSHOTS the supplier's name and WhatsApp number, so a
 *     later edit in Suppliers never rewrites who this enquiry went to.
 *   • A quote points at an item by the item's _id; removing an item drops its quotes.
 *   • Purely a record: it never touches catalogue prices, orders or payments.
 */
const PhotoSchema = new mongoose.Schema({
  publicId: { type: String, required: true },
  provider: { type: String, default: '' },
  contentType: { type: String, default: '' },
  bytes: { type: Number, default: 0 },
  name: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
});

const ItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  name: { type: String, required: true, maxlength: 200 },
  brand: { type: String, default: '', maxlength: 80 },
  partNo: { type: String, default: '', maxlength: 80 },
  fitment: { type: String, default: '', maxlength: 160 },
  qty: { type: Number, required: true, min: 1, max: 100000 },
  unit: { type: String, default: 'pcs', maxlength: 20 },
  // Our target / last price paid, per unit — shown to suppliers only if showTargetPrice.
  targetPaise: { type: Number, default: null },
  note: { type: String, default: '', maxlength: 300 },
  // The catalogue product's first image (a public URL) — looked up by the server, never sent by the client.
  image: { type: String, default: '' },
  // Photos procurement uploaded (private storage; served only through the API).
  photos: { type: [PhotoSchema], default: [] },
});

const QuoteSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, required: true },
  unitPaise: { type: Number, default: null },
  gstRate: { type: Number, default: null },
  gstIncluded: { type: Boolean, default: false },
  available: { type: String, enum: ['yes', 'partial', 'no', ''], default: '' },
  dispatchDays: { type: Number, default: null },
  note: { type: String, default: '', maxlength: 300 },
}, { _id: false });

const SupplierRowSchema = new mongoose.Schema({
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  // First time someone opened WhatsApp / shared the message for this supplier.
  sentAt: { type: Date, default: null },
  repliedAt: { type: Date, default: null },
  quotes: { type: [QuoteSchema], default: [] },
  note: { type: String, default: '', maxlength: 500 },
});

const SupplierEnquirySchema = new mongoose.Schema(
  {
    ref: { type: String, required: true },
    status: { type: String, enum: ['sent', 'replied', 'closed'], default: 'sent' },
    items: { type: [ItemSchema], default: [] },
    suppliers: { type: [SupplierRowSchema], default: [] },
    neededBy: { type: Date, default: null },
    deliverTo: { type: String, default: '', maxlength: 200 },
    notes: { type: String, default: '', maxlength: 1000 },
    showTargetPrice: { type: Boolean, default: false },
    contactName: { type: String, default: '' },
    // Lower-cased ref + item names + supplier names: the list's search.
    searchText: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    closedByName: { type: String, default: '' },
    closeNote: { type: String, default: '', maxlength: 500 },
    chosenSupplier: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    // The form's one-time key: a double-click or a retried request saves one enquiry.
    formKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

SupplierEnquirySchema.index({ ref: 1 }, { unique: true, name: 'supplier_enquiry_ref' });
// The list, newest first (keyset on createdAt + _id), with and without the status filter.
SupplierEnquirySchema.index({ createdAt: -1, _id: -1 }, { name: 'supplier_enquiry_newest' });
SupplierEnquirySchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'supplier_enquiry_status_newest' });
// $type, not $exists/$ne: a partialFilterExpression rejects $ne (see root CLAUDE.md).
SupplierEnquirySchema.index(
  { createdBy: 1, formKey: 1 },
  { unique: true, name: 'supplier_enquiry_form_key', partialFilterExpression: { formKey: { $type: 'string' } } },
);

export default mongoose.models.SupplierEnquiry || mongoose.model('SupplierEnquiry', SupplierEnquirySchema);
