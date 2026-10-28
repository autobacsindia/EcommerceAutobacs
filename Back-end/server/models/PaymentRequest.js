import mongoose from 'mongoose';

/**
 * A request for the company to pay someone — a supplier for an order's item,
 * or a staff expense (fuel, travel, food, a purchase for the company).
 *
 * The life of a request (services/paymentRequestService.js enforces it):
 *
 *   submitted ──accounts approves──▶ approved ──admin pays──▶ paid
 *       │                               │  ▲
 *       │                               ▼  │ paid later
 *       │                            on_hold (parked: a queried bill, funds not
 *       │                                     in yet — accounts OR the admin)
 *       ├──accounts declines──▶ declined
 *       └──requester cancels──▶ cancelled
 *
 * ACCOUNTS approves, the ADMIN pays — one rule for every team's expense and for
 * procurement's supplier payments alike. (This diagram had the two swapped: it
 * described an earlier flow where the admin approved and accounts paid.) The
 * admin is not asked anything until accounts has approved, which is the point —
 * every payment goes through accounts first.
 *
 * The website never moves money here: the admin pays (Razorpay / bank / UPI) and
 * records the reference and a screenshot. Every change is a compare-and-set on
 * the current status, so a double click or two people at once cannot approve or
 * pay twice; every change is appended to `history`.
 *
 * A financial record: never deleted. Payee bank details are kept because they
 * are what was paid; they are shown only to the people in the approval chain.
 */

const FileSchema = new mongoose.Schema(
  {
    // 'bill' — supplier invoice / receipt; 'qr' — the payee's payment QR;
    // 'proof' — the payment screenshot, uploaded by whoever paid (the admin).
    kind: { type: String, enum: ['bill', 'qr', 'proof'], required: true },
    publicId: { type: String, required: true },
    provider: { type: String, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    name: { type: String, default: '', maxlength: 200 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const HistorySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    role: { type: String, default: '' }, // team, or 'admin'
    action: { type: String, required: true },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

const PaymentRequestSchema = new mongoose.Schema(
  {
    // PR-0001 … from the 'payment_request' counter: what people quote on the phone.
    number: { type: String, required: true },
    kind: { type: String, enum: ['supplier', 'expense'], required: true },
    status: {
      type: String,
      enum: ['submitted', 'approved', 'on_hold', 'paid', 'declined', 'cancelled'],
      default: 'submitted',
      required: true,
    },

    team: { type: String, required: true }, // requester's team (procurement, operations, marketing…)
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, required: true },

    // Rupees, two decimals at most. Never derived from client totals elsewhere.
    amount: { type: Number, required: true, min: 1 },
    // Expenses: fuel | travel | food | purchase | other. Supplier requests: 'supplier'.
    category: { type: String, required: true },
    description: { type: String, default: '', maxlength: 2000 },

    payee: {
      name: { type: String, required: true, maxlength: 120 },
      method: { type: String, enum: ['upi', 'bank'], required: true },
      upiId: { type: String, default: '', maxlength: 100 },
      accountName: { type: String, default: '', maxlength: 120 },
      accountNumber: { type: String, default: '', maxlength: 34 },
      ifsc: { type: String, default: '', maxlength: 11 },
      bankName: { type: String, default: '', maxlength: 120 },
      phone: { type: String, default: '', maxlength: 20 },
    },

    // Supplier requests: what the payment is for, snapshotted when raised so the
    // slip still reads correctly if the order changes later.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },
    itemIds: [{ type: mongoose.Schema.Types.ObjectId }],
    itemNames: [{ type: String }],
    customer: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      city: { type: String, default: '' },
    },
    // Who closed the sale: a GTM lead's name, or 'Website'.
    closedBy: { type: String, default: '' },

    // Supplier requests raised from the supplier directory (models/Supplier.js).
    // `payee` above is still the copy that is paid — editing the supplier never
    // rewrites it. `bankNotice` is set when the supplier's bank details changed
    // shortly before this was raised: shown to accounts and the admin.
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    bankNotice: {
      type: new mongoose.Schema({ at: Date, byName: { type: String, default: '' } }, { _id: false }),
      default: null,
    },

    files: { type: [FileSchema], default: [] },

    // Filled when accounts records the payment.
    payment: {
      method: { type: String, enum: ['razorpay', 'bank', 'upi', 'other'], default: undefined },
      reference: { type: String, default: '', maxlength: 120 },
      paidAt: { type: Date, default: null }, // when it was RECORDED here
      // When the money actually moved (the admin enters it; defaults to paidAt).
      // Printed on the receipt beside the recorded time — they differ when a
      // transfer is recorded later.
      transactionAt: { type: Date, default: null },
      paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      paidByName: { type: String, default: '' },
      // Set when several requests to one payee were paid in one transfer.
      batch: { type: String, default: '' },
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },

    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

PaymentRequestSchema.index({ number: 1 }, { unique: true, name: 'payment_request_number' });
// Lists: by status (admin, accounts) and by requester's team, newest first (keyset on createdAt, _id).
PaymentRequestSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_status' });
PaymentRequestSchema.index({ team: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_team' });
// The admin activity feed: most recently changed first.
PaymentRequestSchema.index({ updatedAt: -1 }, { name: 'payment_request_updated' });
// "Is there a supplier request in flight for this order?" (shipping guard, order panel).
PaymentRequestSchema.index(
  { order: 1, status: 1 },
  { name: 'payment_request_order', partialFilterExpression: { order: { $type: 'objectId' } } }
);

export default mongoose.models.PaymentRequest || mongoose.model('PaymentRequest', PaymentRequestSchema);
