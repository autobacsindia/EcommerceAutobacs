import mongoose from "mongoose";
import { SOURCE_TYPES, LEAD_STATUSES } from "../config/leadConstants.js";

/**
 * Lead — the Sales CRM's single source of truth for a prospect.
 *
 * Person-centric: one document per identity (email preferred, else phone),
 * deduped via `identityKey`. A person can surface through several signals
 * (a consultation AND an abandoned checkout), collected in `sources[]`. The
 * source tables (Consultation, Order, Cart, User) keep their own native state;
 * leadSyncService is the ONLY writer that maps them onto this document, so
 * status mirroring can't loop or drift.
 *
 * Sources considered (per product decision): consultancy queries, dormant
 * registered users, and orders/carts that stalled BEFORE payment
 * (payment_pending, payment_failed, cart_abandoned). Admin-cancelled orders are
 * deliberately excluded — a cancellation is an admin action, not a live prospect.
 */

const LeadSourceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SOURCE_TYPES, required: true },
    ref: { type: mongoose.Schema.Types.ObjectId, refPath: "sources.refModel" },
    refModel: { type: String, enum: ["Consultation", "Order", "Cart", "User"] },
    capturedAt: { type: Date, default: Date.now },
    // Small denormalized detail for list display without a join (cart total,
    // vehicle/makeModel, item count). Kept intentionally tiny.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// A source as archived inside a closed cycle. Deliberately NOT the live
// LeadSourceSchema: no `refPath` (we never populate archived sources), just a
// flat snapshot for historical display.
const ArchivedSourceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SOURCE_TYPES },
    ref: { type: mongoose.Schema.Types.ObjectId },
    refModel: { type: String },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    capturedAt: { type: Date },
  },
  { _id: false }
);

// A completed sales cycle, archived when a closed (won/lost) lead is reopened by
// a fresh signal. Preserves outcome, attribution, and timing so the leaderboard
// and history survive the reopen. See ADR-006.
const LeadCycleSchema = new mongoose.Schema(
  {
    startedAt: { type: Date },
    closedAt: { type: Date, default: Date.now },
    outcome: { type: String, enum: LEAD_STATUSES }, // 'won' | 'lost' in practice
    sources: { type: [ArchivedSourceSchema], default: [] },
    primarySource: { type: String, enum: SOURCE_TYPES },
    // Named rep credited when this cycle closed — preserves "who won it" across a reopen.
    assignedRep: { type: mongoose.Schema.Types.ObjectId, ref: "SalesRep", default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    contactedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    convertedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    convertedAt: { type: Date, default: null },
    lostReason: { type: String, default: "" },
  },
  { _id: false }
);

const LeadActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["note", "call", "email", "sms", "status_change", "claim", "assignment", "conversion"],
      required: true,
    },
    // `by` = the User (shared admin console operator) who performed the action —
    // audit trail. `rep` = the name-only SalesRep profile credited for it, which
    // is what the CRM actually displays ("Rahul logged a call"). See SalesRep.js.
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rep: { type: mongoose.Schema.Types.ObjectId, ref: "SalesRep", default: null },
    at: { type: Date, default: Date.now },
    notes: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const LeadSchema = new mongoose.Schema(
  {
    // ── Identity (dedup) ──────────────────────────────────────────────────────
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: null },
    phone: { type: String, trim: true, default: null },
    // Canonical dedup key: `email:<addr>` or `phone:<digits>`. Unique so upserts
    // collapse repeat signals from the same person onto one lead.
    identityKey: { type: String, required: true, unique: true },

    // ── Sources / signals ─────────────────────────────────────────────────────
    sources: { type: [LeadSourceSchema], default: [] },
    primarySource: { type: String, enum: SOURCE_TYPES }, // strongest/most-recent, for list badge + filter

    // ── CRM state (source of truth) ───────────────────────────────────────────
    status: { type: String, enum: LEAD_STATUSES, default: "new", index: true },
    // Named owner (the displayed "who claimed this"). null = unclaimed pool.
    // This is the source of truth for ownership under name-only reps.
    assignedRep: { type: mongoose.Schema.Types.ObjectId, ref: "SalesRep", default: null },
    // `assignedTo` = the User who performed the assignment (shared admin operator),
    // kept for audit only; ownership display + filtering use `assignedRep`.
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },
    contactedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastContactedAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null },
    lostReason: { type: String, default: "" },

    // ── Priority score ────────────────────────────────────────────────────────
    // Denormalized 0–100 hotness/priority, computed by utils/leadScore.js on every
    // sync write and refreshed by the daily sweep (for recency decay). Drives the
    // default worklist sort so strong leads outrank the low-intent flood. Closed
    // (won/lost) leads score 0. Never hand-edited — it's a projection of the doc.
    leadScore: { type: Number, default: 0, index: true },

    // ── Tags ──────────────────────────────────────────────────────────────────
    hasPurchased: { type: Boolean, default: false }, // "already bought before"
    linkedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── Activity log ──────────────────────────────────────────────────────────
    activities: { type: [LeadActivitySchema], default: [] },

    // ── Conversion ────────────────────────────────────────────────────────────
    convertedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    convertedAt: { type: Date, default: null },

    // ── Cycle lifecycle (reopen-with-history) ─────────────────────────────────
    // The person is permanent; a *cycle* opens, closes (won/lost), and can reopen
    // when a fresh workable signal arrives. `cycles[]` archives the closed ones so
    // status/attribution/history survive a reopen. See ADR-006 + leadSyncService.
    cycleStartedAt: { type: Date, default: Date.now },
    reopenCount: { type: Number, default: 0 },
    cycles: { type: [LeadCycleSchema], default: [] },
  },
  { timestamps: true }
);

// List filters + worklist queries.
LeadSchema.index({ email: 1 }, { sparse: true });
LeadSchema.index({ phone: 1 }, { sparse: true });
LeadSchema.index({ assignedRep: 1, status: 1 }); // rep queue, pool
LeadSchema.index({ assignedTo: 1, status: 1 }); // audit-side queries
LeadSchema.index({ status: 1, createdAt: -1 }); // list default sort within a status
// Serves the default worklist sort: a pool/rep queue (assignedRep equality) ranked by
// { leadScore, createdAt }. The sort keys follow assignedRep directly — the common
// list view sends NO status filter, so status must NOT sit between them or it would
// break sort-coverage and force a blocking in-memory sort (risking the sort memory
// limit on a large collection). status/primarySource are applied as residual filters.
// (The 'All' assignment view has no assignedRep equality and still blocking-sorts —
// inherent, and far less frequent than the default pool view.)
LeadSchema.index({ assignedRep: 1, leadScore: -1, createdAt: -1 });
LeadSchema.index({ primarySource: 1 });
LeadSchema.index({ hasPurchased: 1 });
LeadSchema.index({ reopenCount: 1 }); // "reopened / returning" segment filter
LeadSchema.index({ nextFollowUpAt: 1 }, { sparse: true }); // follow-up sweep
LeadSchema.index({ "sources.ref": 1 }); // reverse lookup from a source doc

export default mongoose.model("Lead", LeadSchema);
