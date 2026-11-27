import mongoose from 'mongoose';

/**
 * OrderLineMargin — what we make on each order line bought from a supplier: one row
 * per (order, item), for the admin's Margins panel.
 *
 * A REPORT CACHE, never a source of truth. Every row is recomputed from the order and
 * its supplier payment requests (services/supplierMarginService.refreshOrder) after any
 * supplier payment on the order is raised, edited, declined or cancelled, and
 * scripts/backfill-order-line-margins.js rebuilds it for any orders. Wrong or missing
 * rows heal on the next refresh; nothing reads them to move money.
 *
 * Money in integer paise, margin in basis points (utils/supplierMargin.js).
 */
const OrderLineMarginSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, default: '' },
    orderDate: { type: Date, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    name: { type: String, default: '', maxlength: 300 },
    quantity: { type: Number, default: 0 },
    salePaise: { type: Number, required: true },
    costPaise: { type: Number, required: true },
    // null when a cost is in a foreign currency not yet paid (rupees unknown).
    bp: { type: Number, default: null },
    minBp: { type: Number, required: true },
    below: { type: Boolean, default: false },
    // The supplier payments this cost is from, and who was paid.
    refs: { type: [String], default: [] },
    suppliers: { type: [String], default: [] },
    cancelled: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'orderlinemargins' },
);

OrderLineMarginSchema.index({ order: 1, itemId: 1 }, { unique: true, name: 'order_line_margin_line' });
// The panel's two sorts within a date range: newest first, and lowest margin first.
OrderLineMarginSchema.index({ orderDate: -1, _id: -1 }, { name: 'order_line_margin_date' });
OrderLineMarginSchema.index({ bp: 1, _id: 1 }, { name: 'order_line_margin_bp' });

export default mongoose.models.OrderLineMargin || mongoose.model('OrderLineMargin', OrderLineMarginSchema);
