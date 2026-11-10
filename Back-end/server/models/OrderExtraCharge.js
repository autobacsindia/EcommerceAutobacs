import mongoose from 'mongoose';
import { offlineRefundFields } from './shared/offlineRefundFields.js';

/**
 * An extra amount the customer agreed to pay on an order they have ALREADY paid.
 *
 *   awaiting_accounts ──accounts approves──▶ approved ──customer pays──▶ paid
 *          │                                    │
 *          ├──accounts rejects──▶ rejected      └──GTM cancels──▶ cancelled
 *          └──GTM cancels──▶ cancelled
 *
 * ORDERS ARE IMMUTABLE FINANCIAL RECORDS. Nothing here changes the Order: not
 * totalAmount, paymentStatus, paidAt, listDate or invoiceNo. The server works out
 * "original + paid extras" from these rows (utils/extraCharge.js).
 *
 * Its own collection, like BankTransfer: the Accounts queue and the bell read a few
 * rows, and an extra has its own payment, receipt and refund.
 *
 * Every change is a compare-and-set on `status`, so a double click or two people at
 * once act once. A financial record: never deleted.
 */
const LinkSchema = new mongoose.Schema({
  id: { type: String, required: true },
  url: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'paid', 'cancelled', 'expired'], default: 'pending' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const HistorySchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  action: { type: String, required: true },
  note: { type: String, default: '', maxlength: 1000 },
}, { _id: false });

const RefundSchema = new mongoose.Schema({
  status: { type: String, enum: ['due', 'processing', 'completed', 'failed'], required: true },
  dueReason: { type: String, default: '' },
  method: { type: String, enum: ['razorpay', 'offline'], default: undefined },
  amountPaise: { type: Number, default: undefined },
  razorpayRefundId: { type: String, default: undefined },
  failureReason: { type: String, default: undefined },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
  byName: { type: String, default: undefined },
  completedAt: { type: Date, default: undefined },
  ...offlineRefundFields(),
}, { _id: false });

const OrderExtraChargeSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderNumber: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the customer
  salesUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  salesUserName: { type: String, default: '' },
  customer: { name: { type: String, default: '' }, city: { type: String, default: '' } },

  sequence: { type: Number, required: true }, // "Extra 2" on this order
  // A fresh key per form opened: pressing Save twice makes one extra.
  clientKey: { type: String, required: true, maxlength: 64 },

  amount: { type: Number, required: true, min: 1 }, // rupees, GST included
  reason: { type: String, required: true, maxlength: 500 },
  customerConfirmed: { type: Boolean, required: true },

  status: {
    type: String,
    enum: ['awaiting_accounts', 'approved', 'paid', 'rejected', 'cancelled'],
    default: 'awaiting_accounts',
    required: true,
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByName: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: '', maxlength: 500 },

  // Every Razorpay link made for this extra; at most one is live at a time.
  links: { type: [LinkSchema], default: [] },
  // A bank transfer is recorded and waiting for Accounts (models/BankTransfer.js).
  bankTransferPendingAt: { type: Date, default: undefined },
  transfer: { type: mongoose.Schema.Types.ObjectId, ref: 'BankTransfer', default: undefined },

  // Filled once, when the money is confirmed.
  paidVia: { type: String, enum: ['razorpay', 'bank_transfer'], default: undefined },
  paidAt: { type: Date, default: null }, // what sales reports count it under
  gatewayPaymentId: { type: String, default: undefined },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: undefined },
  // Its own number from the invoice series, assigned once when the receipt is made.
  receiptNo: { type: Number, default: undefined },
  receiptEmailedAt: { type: Date, default: undefined },

  refund: { type: RefundSchema, default: undefined },
  history: { type: [HistorySchema], default: [] },
}, { timestamps: true });

// Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off in production).
OrderExtraChargeSchema.index({ order: 1, sequence: 1 }, { unique: true, name: 'extra_charge_order_sequence' });
OrderExtraChargeSchema.index({ order: 1, clientKey: 1 }, { unique: true, name: 'extra_charge_order_client_key' });
OrderExtraChargeSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'extra_charge_status_recent' });
OrderExtraChargeSchema.index({ salesUser: 1, createdAt: -1, _id: -1 }, { name: 'extra_charge_seller_recent' });
// Sales reports: money received in a date range.
OrderExtraChargeSchema.index({ status: 1, paidAt: -1 }, { name: 'extra_charge_status_paid_at' });
// Webhook lookup and the missed-webhook sweep.
OrderExtraChargeSchema.index(
  { 'links.id': 1 },
  { name: 'extra_charge_link_id', partialFilterExpression: { 'links.id': { $type: 'string' } } },
);
OrderExtraChargeSchema.index(
  { 'links.status': 1, _id: 1 },
  { name: 'extra_charge_link_pending', partialFilterExpression: { 'links.status': 'pending' } },
);
// Admin's "refund due" list.
OrderExtraChargeSchema.index(
  { 'refund.status': 1, createdAt: -1, _id: -1 },
  { name: 'extra_charge_refund_status', partialFilterExpression: { 'refund.status': { $type: 'string' } } },
);

export default mongoose.models.OrderExtraCharge || mongoose.model('OrderExtraCharge', OrderExtraChargeSchema, 'order_extra_charges');
