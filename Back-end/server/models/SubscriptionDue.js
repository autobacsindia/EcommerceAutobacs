import mongoose from 'mongoose';

/**
 * A tool, subscription or purchase the company pays for, and when it is next
 * due — Railway, MongoDB Atlas, Google Workspace… (Payments → Subscriptions &
 * dues). Each team records its own; accounts checks them.
 *
 *   pending (waiting for check) ──accounts verifies──▶ verified
 *       │   ▲                                            │
 *       │   └── edited (rejected item fixed, or the money ┘ of a verified one changed)
 *       └──accounts rejects (with a reason)──▶ rejected
 *
 * What it is NOT: a payment. Nothing here moves money or adds to the expense
 * totals. "Mark paid" on a due cycle raises an expense in Payments
 * (models/PaymentRequest.js), and accounts approves that — see CycleSchema.
 *
 * Never holds a full card number, CVV or password: the card is its last 4 digits
 * only, and free text that looks like a card number is refused on save
 * (services/subscriptionDueService.js).
 *
 * Never deleted: "delete" archives it (out of every list), and `history` keeps
 * who did what and when. `rev` goes up on every write, and every write is a
 * compare-and-set on it, so two people editing at once cannot overwrite each other.
 */

const FileSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['invoice'], required: true },
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
    // added | edited | verified | rejected | archived
    action: { type: String, required: true },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

/**
 * One cycle of a bill, as marked paid: "Nov — USD 112, paid by card on 2 Dec,
 * expense PR-0912". `dueDate` is the cycle's due day (the item's dueDate when it
 * was marked), so each cycle is marked once while it is live.
 *
 * Marking it paid raises ONE expense in Payments (`expense`), which accounts
 * approves or declines. `state` follows that expense:
 *
 *   waiting (accounts to approve) ──approved──▶ approved (admin to pay; only when
 *       │                                        │       it was NOT paid already)
 *       │                                        ▼
 *       ├──────────── already paid, approved ──▶ paid ── the item's due date moves on
 *       └──declined / cancelled──▶ rejected (the cycle is due again; mark it paid again)
 *
 * Cycles recorded before this existed (usage-based bills, invoice on the cycle)
 * have no `state` and read as paid. Never removed: it is the paid history.
 */
const CycleSchema = new mongoose.Schema(
  {
    dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // The bill, in the item's currency.
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true, maxlength: 3 },
    // The plan amount (or estimate) at the time, for "estimate USD 100 → actual USD 112".
    estimate: { type: Number, default: null },
    // Older cycles only: the invoice was kept here. New cycles keep it on the expense.
    invoices: { type: [FileSchema], default: [] },
    note: { type: String, default: '', maxlength: 500 },
    // Who marked it paid, and when that was recorded.
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paidByName: { type: String, default: '' },
    paidAt: { type: Date, required: true },

    // ── Marked paid → expense (absent on older cycles) ──
    state: { type: String, enum: ['waiting', 'approved', 'paid', 'rejected'], default: undefined },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', default: undefined },
    expenseNumber: { type: String, default: undefined },
    // true: the money already left (company card, auto-debit) — approving it closes it.
    alreadyPaid: { type: Boolean, default: undefined },
    // card | upi | bank | auto_debit, the day it was paid, and the UTR / reference.
    paidVia: { type: String, default: undefined },
    paidOn: { type: String, default: undefined },
    reference: { type: String, default: undefined, maxlength: 120 },
    // Why the amount differs from the plan amount (a fixed bill only).
    amountReason: { type: String, default: undefined, maxlength: 300 },
    // What it cost in rupees, once known (the expense's amount).
    rupees: { type: Number, default: undefined },
    rejectReason: { type: String, default: undefined, maxlength: 1000 },
    settledAt: { type: Date, default: undefined },
  },
  { _id: true }
);

const SubscriptionDueSchema = new mongoose.Schema(
  {
    // SD-0001 … from the 'subscription_due' counter.
    number: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    purpose: { type: String, default: '', maxlength: 300 },
    team: { type: String, required: true },
    // monthly | yearly | one_time
    kind: { type: String, enum: ['monthly', 'yearly', 'one_time'], required: true },

    // What the bill says, in its own currency — "USD 20". Never converted and
    // stored: a rupee figure shown beside it is a rough guide worked out on read.
    // For a usage-based bill (`variableAmount`), this is the ESTIMATE; each
    // cycle's real amount is entered when it is paid and kept in `cycles`.
    amount: { type: Number, required: true, min: 0 },
    // "Amount varies (usage-based)" — MongoDB Atlas, Railway… Absent on items
    // added before it existed, which reads as false: a fixed amount.
    variableAmount: { type: Boolean, default: false },
    currency: { type: String, required: true, maxlength: 3 },
    // The next due DAY in India time, 'YYYY-MM-DD' — a calendar day, not an
    // instant, so "due on 2 Dec" means 2 Dec whatever the server's clock zone.
    // Sorts as a string in date order.
    dueDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    payment: {
      method: { type: String, enum: ['card', 'upi', 'bank_transfer'], required: true },
      // The card's LAST 4 digits only, and only for a card. Never more.
      cardLast4: { type: String, default: '', match: /^(\d{4})?$/ },
      autoDebit: { type: Boolean, default: false },
    },
    billingUrl: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 6000 },
    files: { type: [FileSchema], default: [] },
    // The paid history, oldest first (one per cycle, ~12 a year; a rejected one stays, marked so).
    cycles: { type: [CycleSchema], default: [] },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', required: true },
    rejectReason: { type: String, default: '', maxlength: 1000 },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedByName: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    addedByName: { type: String, required: true },

    // "Delete" = archive: out of every list, never out of the database.
    archived: { type: Boolean, default: false, required: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    archivedByName: { type: String, default: '' },

    rev: { type: Number, default: 0, required: true },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

SubscriptionDueSchema.index({ number: 1 }, { unique: true, name: 'subscription_due_number' });
/*
  The list, soonest due first (keyset on dueDate, _id). Every list read carries
  `archived: false`; a team reads its own (team_due), accounts / admin read every
  team (due), optionally narrowed to one status (status_due).
*/
SubscriptionDueSchema.index({ archived: 1, dueDate: 1, _id: 1 }, { name: 'subscription_due_due' });
SubscriptionDueSchema.index({ team: 1, archived: 1, dueDate: 1, _id: 1 }, { name: 'subscription_due_team_due' });
SubscriptionDueSchema.index({ archived: 1, status: 1, dueDate: 1, _id: 1 }, { name: 'subscription_due_status_due' });

export default mongoose.models.SubscriptionDue || mongoose.model('SubscriptionDue', SubscriptionDueSchema);
