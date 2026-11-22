import mongoose from 'mongoose';
import { SlipReadSchema } from './shared/slipReadSchema.js';

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

/*
  One edit made before approval (services/paymentRequestService.js update): why,
  who, when, and each field's old → new value as shown to people (₹ amounts,
  names). Accounts reads these before approving. Never rewritten.
*/
const EditSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    role: { type: String, default: '' },
    reason: { type: String, required: true, maxlength: 1000 },
    // The status it was edited from: an on-hold or declined request goes back to accounts.
    fromStatus: { type: String, default: '' },
    changes: {
      type: [new mongoose.Schema({
        field: { type: String, required: true },
        from: { type: String, default: '', maxlength: 300 },
        to: { type: String, default: '', maxlength: 300 },
      }, { _id: false })],
      default: [],
    },
    // The form's one-time key: a double-submitted edit is saved once.
    formKey: { type: String, default: undefined, maxlength: 64 },
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

    // Rupees, two decimals at most: what is approved, paid and totalled. Never
    // derived from client totals elsewhere.
    //   • A rupee request: at least ₹1, from the moment it is raised.
    //   • A foreign-currency expense (procurement imports) raised since the rate
    //     box was dropped: 0 until it is PAID — the rupees are not known until the
    //     bank debits them, and the admin records that figure with the payment.
    //     0 rather than null so the amount sort / cursor still page every row
    //     (a null drops out of a `$lte` range); `shape().rupeesPending` says it.
    amount: { type: Number, required: true, min: 0 },
    // A foreign-currency expense: what was billed, and the rupees-per-unit rate.
    //   • older records: the rate from the quote typed in, `amount` worked out from it;
    //   • newer ones: null until paid, then the bank debit ÷ the bill.
    // Absent / 'INR' on every rupee request, old ones too.
    currency: { type: String, default: 'INR', maxlength: 3 },
    foreignAmount: { type: Number, default: null },
    fxRate: { type: Number, default: null },
    // Expenses: the team's own list (config/expenseCategories.js); records from
    // before per-team lists keep fuel | travel | food | purchase | other.
    // Supplier requests: 'supplier'.
    category: { type: String, required: true },
    description: { type: String, default: '', maxlength: 12000 },

    payee: {
      // Expense requests may leave every pay detail blank (accounts fills them in):
      // name '' and method '' then. Supplier payments always carry both.
      name: { type: String, default: '', maxlength: 120 },
      method: { type: String, enum: ['upi', 'bank', 'card', ''], default: '' },
      upiId: { type: String, default: '', maxlength: 100 },
      accountName: { type: String, default: '', maxlength: 120 },
      accountNumber: { type: String, default: '', maxlength: 34 },
      ifsc: { type: String, default: '', maxlength: 11 },
      // A foreign bank (international suppliers): its SWIFT / BIC instead of an
      // IFSC — exactly one of the two is set. '' on every record from before.
      swift: { type: String, default: '', maxlength: 11 },
      bankName: { type: String, default: '', maxlength: 120 },
      phone: { type: String, default: '', maxlength: 20 },
      // Card (expense requests only): WHICH company card, never the card itself.
      // PCI DSS — no full number, expiry or CVV is ever stored: last 4 digits only.
      cardType: { type: String, enum: ['credit', 'debit', ''], default: undefined },
      cardNetwork: { type: String, enum: ['visa', 'mastercard', 'rupay', 'amex', ''], default: undefined },
      cardLast4: { type: String, default: undefined, match: /^(\d{4})?$/ },
      cardName: { type: String, default: undefined, maxlength: 120 },
      cardLabel: { type: String, default: undefined, maxlength: 60 },
    },

    // Supplier requests: what the payment is for, snapshotted when raised so the
    // slip still reads correctly if the order changes later.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },
    itemIds: [{ type: mongoose.Schema.Types.ObjectId }],
    itemNames: [{ type: String }],
    // The supplier part of the (one) item this pays for, when the item is bought from
    // several suppliers (Order.workflow.lines[].parts). Absent: the item's first part.
    partId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    partWhat: { type: String, default: undefined, maxlength: 120 },
    customer: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      alternatePhone: { type: String, default: '' },
      city: { type: String, default: '' },
    },
    // Optional: the staff project this cost belongs to (models/StaffProject.js),
    // typed as its code. The code and name are snapshotted, so the request still
    // says "PRJ-0007 Diwali launch" if the project is renamed or deleted later.
    // Only says which project — never changes the money.
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffProject', default: null },
    projectCode: { type: String, default: '' },
    projectName: { type: String, default: '' },
    // A subscription / due's cycle marked paid (models/SubscriptionDue.js): raised by
    // "Mark paid", never typed. Snapshotted like the project link. `alreadyPaid`: the
    // money already left (company card, auto-debit) — accounts' approval closes it as
    // paid with `paid` (how / when / reference) instead of asking the admin to pay.
    subscription: {
      type: new mongoose.Schema({
        item: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionDue', required: true },
        number: { type: String, required: true },
        name: { type: String, default: '' },
        cycle: { type: mongoose.Schema.Types.ObjectId, required: true },
        cycleDueDate: { type: String, required: true },
        alreadyPaid: { type: Boolean, default: false },
        paid: {
          type: new mongoose.Schema({
            method: { type: String, enum: ['bank', 'upi', 'card', 'other'], required: true },
            autoDebit: { type: Boolean, default: false },
            on: { type: Date, required: true },
            reference: { type: String, default: '', maxlength: 120 },
          }, { _id: false }),
          default: undefined,
        },
      }, { _id: false }),
      default: undefined,
    },
    // Optional: the staff task this cost was for (models/StaffTask.js) — procurement
    // claims fuel per pickup. Number and title snapshotted like the project, so the
    // request still reads "T-42 Pick up Hilux bumper" after a rename or delete.
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTask', default: null },
    taskNumber: { type: Number, default: null },
    taskTitle: { type: String, default: '' },
    // A Reimbursement expense (category 'reimbursement', services/reimbursement.js):
    // what kind, the day it was spent (IST 'YYYY-MM-DD'), and for Fuel the km and the
    // per-km rate AT SUBMIT — `amount` = km × ratePerKm, worked out by the server.
    // The rate is a snapshot: changing the admin's rate never rewrites a claim.
    // Absent on every other request.
    reimbursement: {
      type: new mongoose.Schema({
        type: { type: String, enum: ['fuel', 'food', 'transport', 'other'], required: true },
        on: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        km: { type: Number, default: null, min: 0 },
        ratePerKm: { type: Number, default: null, min: 0 },
        from: { type: String, default: '', maxlength: 120 },
        to: { type: String, default: '', maxlength: 120 },
      }, { _id: false }),
      default: undefined,
    },
    // Optional: any other ID the cost belongs to (a supplier invoice number, a
    // courier AWB, a ClickUp task) — free text, searched by the admin's lookup.
    reference: { type: String, default: '', maxlength: 60 },
    // The browser's id for this submit, so a double-clicked "Submit" or a
    // replayed request raises one request (unique per requester, below).
    clientId: { type: String, default: undefined, maxlength: 64 },

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
    // Supplier credit used on this payment (models/SupplierLedgerEntry.js): `amount`, in
    // this request's currency, came off what the supplier owes us, so the money moved is
    // `amount` / `foreignAmount` (already net). The bill is net + credit (deal math uses the bill).
    credit: {
      type: new mongoose.Schema({
        amount: { type: Number, required: true, min: 0.01 },
        entry: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierLedgerEntry', required: true },
      }, { _id: false }),
      default: null,
    },

    // A supplier payment that is one part of a made-to-order deal (models/SupplierDeal.js):
    // 'advance' (the first part), 'part', 'balance' (the part that completes the
    // agreed total) or 'full' (the whole agreed total in one payment). Worked out by the server from the deal, never sent by the client.
    deal: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierDeal', default: null },
    part: { type: String, enum: ['advance', 'part', 'balance', 'full', ''], default: '' },

    files: { type: [FileSchema], default: [] },

    // Filled when accounts records the payment.
    payment: {
      method: { type: String, enum: ['razorpay', 'bank', 'upi', 'card', 'other'], default: undefined },
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
      // Which of reference / transaction time were read from the slip vs typed (shared/slipReadSchema.js).
      slipRead: { type: SlipReadSchema, default: null },
      // Paid from a foreign-currency account (e.g. a Thai bank account): no rupees
      // were debited, so `amount` stays 0 and the bill's own currency is what moved.
      // `amount` here is what was sent, in `currency` (always the bill's currency).
      // null on every rupee payment, old ones too.
      fromAccount: {
        type: new mongoose.Schema({
          currency: { type: String, required: true, maxlength: 3 },
          amount: { type: Number, required: true, min: 0.01 },
          label: { type: String, default: '', maxlength: 80 },
        }, { _id: false }),
        default: undefined,
      },
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },

    history: { type: [HistorySchema], default: [] },

    // Bumped by every edit. Approve sends the rev it showed accounts, so an edit
    // that lands first makes the approval fail ("changed — check it again")
    // instead of approving figures nobody looked at. Old records have none (= 0).
    rev: { type: Number, default: 0 },
    // Set by the first edit after submitting: the lists' "Edited after submit" tag.
    editedAt: { type: Date, default: null },
    edits: { type: [EditSchema], default: [] },
  },
  { timestamps: true }
);

PaymentRequestSchema.index({ number: 1 }, { unique: true, name: 'payment_request_number' });
// Lists: by status (admin, accounts) and by requester's team, newest first (keyset on createdAt, _id).
PaymentRequestSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_status' });
PaymentRequestSchema.index({ team: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_team' });
/*
  The list's other sorts, within a status tab (keyset on the sort field, _id).
  Measured on 100,000 requests: "Paid, amount high → low" read all 84,012 paid
  rows and sorted them in memory (66 ms); "Paid, recently paid" the same (92 ms).
  With these: 26 rows read, 1 ms each. Both directions ride one index.
*/
PaymentRequestSchema.index({ status: 1, amount: -1, _id: -1 }, { name: 'payment_request_status_amount' });
PaymentRequestSchema.index({ status: 1, 'payment.paidAt': -1, _id: -1 }, { name: 'payment_request_status_paid' });
// The admin activity feed: most recently changed first.
PaymentRequestSchema.index({ updatedAt: -1 }, { name: 'payment_request_updated' });
// "Is there a supplier request in flight for this order?" (shipping guard, order panel).
PaymentRequestSchema.index(
  { order: 1, status: 1 },
  { name: 'payment_request_order', partialFilterExpression: { order: { $type: 'objectId' } } }
);

/*
  One project's payments, newest first (the admin's project lookup; keyset on createdAt, _id).
  NOT partial on purpose: a partial index needs the query to restate `$type`, and then
  the planner no longer treats the project as an equality and sorts every one of the
  project's payments in memory to show 20 (measured: 200 keys read for a page, in
  tests/linkLookupIndexUsage.test.js). One small null key per other payment is cheaper.
*/
PaymentRequestSchema.index({ project: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_project' });
// One task's payments, newest first (the task's Reimbursements box). Not partial, for
// the same reason as payment_request_project.
PaymentRequestSchema.index({ task: 1, createdAt: -1, _id: -1 }, { name: 'payment_request_task' });
// The monthly reimbursement report: claims by the day they were spent. Only reimbursements.
PaymentRequestSchema.index(
  { 'reimbursement.on': 1 },
  { name: 'payment_request_reimbursement_on', partialFilterExpression: { 'reimbursement.on': { $type: 'string' } } }
);
// "Which payments carry reference INV-2231?" — only rows that have one.
PaymentRequestSchema.index(
  { reference: 1, createdAt: -1 },
  { name: 'payment_request_reference', partialFilterExpression: { reference: { $gt: '' } } }
);
// The slip reader's duplicate-UTR check: "is this UTR on a paid payment already?"
// Without it every slip read scanned every paid payment (measured: 16,000 docs read
// for 20,000 payments → 0 with it). Only rows that have a reference.
PaymentRequestSchema.index(
  { 'payment.reference': 1 },
  { name: 'payment_request_paid_reference', partialFilterExpression: { 'payment.reference': { $gt: '' } } }
);
// A double-submitted expense / supplier request is saved once. `$type`, never `$ne`.
PaymentRequestSchema.index(
  { requestedBy: 1, clientId: 1 },
  { unique: true, name: 'payment_request_client_id', partialFilterExpression: { clientId: { $type: 'string' } } }
);

// A supplier deal's parts (supplierDealService: paid / waiting / balance).
PaymentRequestSchema.index(
  { deal: 1, createdAt: 1 },
  { name: 'payment_request_deal', partialFilterExpression: { deal: { $type: 'objectId' } } }
);

// One expense per marked cycle: a retried "Mark paid" can never raise a second one.
PaymentRequestSchema.index(
  { 'subscription.cycle': 1 },
  { unique: true, name: 'payment_request_subscription_cycle', partialFilterExpression: { 'subscription.cycle': { $type: 'objectId' } } }
);

export default mongoose.models.PaymentRequest || mongoose.model('PaymentRequest', PaymentRequestSchema);
