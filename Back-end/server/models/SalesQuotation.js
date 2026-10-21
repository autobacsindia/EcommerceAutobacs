import mongoose from 'mongoose';

/**
 * A GTM quotation — what the customer is offered BEFORE anything is an order.
 *
 * Quotation-first selling (services/salesQuotationService.js):
 *   open      → shared with the customer as a PDF; editable (each edit bumps
 *               `version` and keeps the previous lines in `revisions`)
 *   accepted  → the customer agreed: an Order was created from these exact lines
 *               (`order`), and payment is requested on that order
 *   cancelled → withdrawn; kept for the record
 *
 * Nothing here is money owed: a quotation never appears in Orders, reports,
 * revenue or the team work lists. Lines are priced by the same server code that
 * prices a sales order (catalogue lines from the catalogue, offer ≤ list; custom
 * lines named and priced by the seller), so accepting one cannot change a price.
 */
const LineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: undefined },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantLabel: { type: String, default: null },
    custom: { type: Boolean, default: undefined },
    name: { type: String, required: true },
    image: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // what the customer pays per unit
    listPrice: { type: Number, default: null }, // catalogue price, only when marked down
  },
  { _id: true }
);

const AddressSchema = new mongoose.Schema(
  {
    fullName: String,
    phone: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'India' },
  },
  { _id: false }
);

const SalesQuotationSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['open', 'accepted', 'cancelled'], default: 'open' },

    customer: {
      name: { type: String, required: true },
      email: { type: String, default: '' }, // optional — a phone-only customer has none
      phone: { type: String, required: true },
    },
    shippingAddress: { type: AddressSchema, required: true },
    items: { type: [LineSchema], default: [] },
    subtotal: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    notes: { type: String, default: '' },

    salesUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    salesRep: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesRep', default: null },
    validUntil: { type: Date, required: true },

    // Previous versions, oldest first — what the customer was shown before an edit.
    revisions: [{
      _id: false,
      version: Number,
      items: [LineSchema],
      totalAmount: Number,
      savedAt: Date,
      savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }],

    // "On hold — customer thinking" (utils/salesHold.js): still open, just parked
    // until the follow-up date. Absent when not on hold.
    hold: {
      type: new mongoose.Schema({
        since: Date,
        until: { type: Date, required: true },
        note: { type: String, default: '' },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byName: String,
      }, { _id: false }),
      default: undefined,
    },

    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

SalesQuotationSchema.index({ number: 1 }, { unique: true, name: 'quotation_number' });
// "My quotations" (newest first, keyset on _id) and the head's team view.
SalesQuotationSchema.index({ salesUser: 1, _id: -1 }, { name: 'quotation_seller_recent' });
SalesQuotationSchema.index({ status: 1, _id: -1 }, { name: 'quotation_status_recent' });
// One quotation ↔ one order, found from the order side.
SalesQuotationSchema.index(
  { order: 1 },
  { unique: true, name: 'quotation_order', partialFilterExpression: { order: { $type: 'objectId' } } }
);

export default mongoose.models.SalesQuotation || mongoose.model('SalesQuotation', SalesQuotationSchema);
