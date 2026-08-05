import mongoose from "mongoose";
import {
  TICKET_STATUSES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  OPEN_TICKET_STATUSES,
} from "../config/supportPolicy.js";

/**
 * A support ticket — one customer conversation, whatever door it came through.
 *
 * Design notes:
 *
 * 1. Messages live in their own collection (models/SupportMessage.js), NOT as a
 *    subdocument array here. A busy ticket accumulates dozens of replies with
 *    quoted history and attachment metadata; embedding them would make every
 *    inbox list query drag the full thread off disk and would eventually walk
 *    into the 16 MB document ceiling.
 *
 * 2. Context is stored as explicit typed refs (order / returnRequest / product /
 *    review / lead) rather than a generic { type, id } pair, so the admin thread
 *    view can `populate` exactly what it needs and Mongo can index each one.
 *
 * 3. `requesterEmail` is the identity spine, mirroring how Lead dedupes people.
 *    Inbound email has no session; the sender address is all we get, and the
 *    `user` ref is resolved opportunistically. It is deliberately NOT trusted for
 *    authorisation — see the note on that field.
 */

/**
 * Denormalised requester snapshot. Email is authoritative for threading and
 * dedupe; `user` is a best-effort link to an account.
 */
const RequesterSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Lowercased at write time by the service. Indexed for "everything from this
  // person" lookups in the admin inbox.
  email: { type: String, required: true, trim: true, lowercase: true },
  name:  { type: String, trim: true, default: "" },
  phone: { type: String, trim: true, default: "" },
}, { _id: false });

const SupportTicketSchema = new mongoose.Schema({
  /**
   * Human-facing reference, e.g. "ABI-1042". Assigned from the atomic
   * `supportTicket` Counter series, so parallel creates can never collide.
   * Immutable once set — it is printed in emails and quoted by customers.
   */
  reference: {
    type: String,
    required: true,
    // `unique` already builds the index; adding `index: true` too would declare
    // it twice.
    unique: true,
    immutable: true,
  },

  subject: { type: String, required: true, trim: true, maxlength: 500 },

  status: {
    type: String,
    enum: TICKET_STATUSES,
    default: "new",
    index: true,
  },

  priority: {
    type: String,
    enum: TICKET_PRIORITIES,
    default: "normal",
    index: true,
  },

  channel: {
    type: String,
    enum: TICKET_CHANNELS,
    required: true,
    index: true,
  },

  requester: { type: RequesterSchema, required: true },

  /**
   * Owning agent. Null means unassigned, which is what the inbox's default
   * "needs triage" filter keys off.
   */
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true,
  },

  // ── Linked commerce context ───────────────────────────────────────────────
  // Any of these may be set; they are what makes an in-house helpdesk worth
  // building over a bought one. Sparse because most tickets link none of them.
  order:         { type: mongoose.Schema.Types.ObjectId, ref: "Order",         default: null, index: { sparse: true } },
  returnRequest: { type: mongoose.Schema.Types.ObjectId, ref: "ReturnRequest", default: null, index: { sparse: true } },
  product:       { type: mongoose.Schema.Types.ObjectId, ref: "Product",       default: null, index: { sparse: true } },
  review:        { type: mongoose.Schema.Types.ObjectId, ref: "Review",        default: null, index: { sparse: true } },
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: "Lead",          default: null, index: { sparse: true } },

  /**
   * Source record for tickets adapted from a pre-existing channel model
   * (ProductQuestion, Contact, …). Lets a backfill run twice without creating
   * duplicate tickets, and lets the adapter find "the ticket for this question".
   */
  sourceModel: { type: String, default: null },
  sourceId:    { type: mongoose.Schema.Types.ObjectId, default: null },

  tags: { type: [String], default: [], index: true },

  // ── SLA ───────────────────────────────────────────────────────────────────
  // Due dates are absolute instants computed at create/priority-change time from
  // the business-hours calendar, so the BullMQ delayed job that fires the breach
  // alert only has to compare against `new Date()`.
  // Indexed at the schema level below with a partial filter, not here — declaring
  // both produces two overlapping indexes and a Mongoose duplicate-index warning.
  firstResponseDueAt:  { type: Date, default: null },
  firstRespondedAt:    { type: Date, default: null },
  firstResponseBreached: { type: Boolean, default: false },
  resolutionDueAt:     { type: Date, default: null, index: { sparse: true } },
  resolvedAt:          { type: Date, default: null },
  resolutionBreached:  { type: Boolean, default: false },
  closedAt:            { type: Date, default: null },

  // ── Activity watermarks ───────────────────────────────────────────────────
  // Drive the "awaiting our reply" / "awaiting customer" inbox views without a
  // per-row lookup into the messages collection.
  lastCustomerMessageAt: { type: Date, default: null },
  lastAgentMessageAt:    { type: Date, default: null },
  lastMessageAt:         { type: Date, default: Date.now, index: true },
  messageCount:          { type: Number, default: 0 },

  /**
   * Outbound sends in the current loop-guard window, plus the window start.
   * Incremented by the send path and reset once the window rolls over; when the
   * count exceeds LOOP_GUARD_MAX_OUTBOUND the ticket stops sending automatic
   * mail and raises `loopGuardTrippedAt` for a human to inspect.
   */
  outboundInWindow:    { type: Number, default: 0 },
  outboundWindowStart: { type: Date, default: null },
  loopGuardTrippedAt:  { type: Date, default: null },

  /** Set when this ticket was merged into another; it then becomes read-only. */
  mergedInto: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
    default: null,
  },

  /**
   * Set when a customer replied to a ticket that was already closed beyond the
   * reopen window — the new ticket points back at the old conversation.
   */
  followUpOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
    default: null,
  },

  /**
   * Marks a ticket raised by inbound mail whose sender we could not match to an
   * account. Purely informational for agents — a reminder to verify identity
   * before disclosing order details, since an SMTP `From:` header is trivially
   * forged and is never treated as proof of who is writing.
   */
  requesterVerified: { type: Boolean, default: false },
}, {
  timestamps: true,
});

// ── Indexes ─────────────────────────────────────────────────────────────────

/** Default inbox view: open work, newest activity first. */
SupportTicketSchema.index({ status: 1, lastMessageAt: -1 });

/** "Everything from this person", and requester-based dedupe on inbound mail. */
SupportTicketSchema.index({ "requester.email": 1, createdAt: -1 });

/** An agent's own queue. */
SupportTicketSchema.index({ assignee: 1, status: 1, lastMessageAt: -1 });

/**
 * Backfill/adapter idempotency: at most one ticket per source record. Partial so
 * the vast majority of tickets (which have no source) are not indexed.
 */
SupportTicketSchema.index(
  { sourceModel: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: "objectId" } } }
);

/**
 * SLA sweep: the nightly reconciliation job scans for unbreached, still-open
 * tickets whose due date has passed — the safety net for delayed BullMQ jobs
 * lost to a Redis flush.
 */
SupportTicketSchema.index(
  { firstResponseDueAt: 1 },
  { partialFilterExpression: { firstResponseBreached: false } }
);

/** Free-text search across the admin inbox (subject + requester). */
SupportTicketSchema.index({ subject: "text", "requester.name": "text", "requester.email": "text" });

// ── Helpers ─────────────────────────────────────────────────────────────────

/** True when the ticket still needs someone to act on it. */
SupportTicketSchema.virtual("isOpen").get(function isOpen() {
  return OPEN_TICKET_STATUSES.includes(this.status);
});

/** True when we have replied and are waiting on the customer. */
SupportTicketSchema.virtual("awaitingCustomer").get(function awaitingCustomer() {
  return this.status === "pending_customer";
});

SupportTicketSchema.set("toJSON", { virtuals: true });
SupportTicketSchema.set("toObject", { virtuals: true });

export default mongoose.models.SupportTicket
  || mongoose.model("SupportTicket", SupportTicketSchema);
