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
 * totals — a bill paid by bank transfer still goes through a payment request.
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
    amount: { type: Number, required: true, min: 0 },
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
    notes: { type: String, default: '', maxlength: 1000 },
    files: { type: [FileSchema], default: [] },

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
