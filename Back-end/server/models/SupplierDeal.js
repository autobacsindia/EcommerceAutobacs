import mongoose from 'mongoose';

/**
 * A supplier deal: an item a supplier MAKES for an order, paid in parts.
 *
 *   Order total ₹29,000 to the supplier. They start only after a ₹10,000 advance;
 *   once the item is ready the ₹19,000 balance is paid, then it ships.
 *
 * The deal holds what was agreed (the total and the supplier's dates). The money
 * is the supplier payment requests that point at it (PaymentRequest.deal) — each
 * one raised by procurement, approved by accounts and paid by the admin exactly
 * like any other supplier payment. Paid / waiting / balance are always worked
 * out from those requests (services/supplierDealService.js), never stored.
 *
 * `reservedPaise` is the one stored sum, and it exists only as a lock: the total
 * of the live (not declined / cancelled) requests on the deal, moved with a
 * conditional $inc so two people raising a payment at the same moment cannot
 * together ask for more than the agreed total. Paise (integers) so repeated
 * adds never drift the way rupee floats do.
 *
 * Optional: most orders never have one, and their supplier payments work as before.
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

const SupplierDealSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, default: '' },
    itemIds: { type: [mongoose.Schema.Types.ObjectId], required: true },
    itemNames: [{ type: String }],
    supplierName: { type: String, required: true, maxlength: 120 },

    agreedPaise: { type: Number, required: true, min: 100 },
    reservedPaise: { type: Number, default: 0, min: 0 },

    // The supplier's dates, 'YYYY-MM-DD' (a calendar day, no time zone to get wrong).
    startDate: { type: String, default: '' },
    completionDate: { type: String, default: '' },

    // open → cancelled (only while nothing is asked for). Never deleted.
    status: { type: String, enum: ['open', 'cancelled'], default: 'open', required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

// The order panel: deals for one order.
SupplierDealSchema.index({ order: 1, createdAt: -1 }, { name: 'supplier_deal_order' });
// One open deal per item. A multikey unique index compares every array element,
// so two open deals can never share an item — even when created at the same moment.
SupplierDealSchema.index(
  { order: 1, itemIds: 1 },
  { name: 'supplier_deal_open_item', unique: true, partialFilterExpression: { status: 'open' } }
);

export default mongoose.models.SupplierDeal || mongoose.model('SupplierDeal', SupplierDealSchema);
