import mongoose from "mongoose";

/**
 * KarmaLedger — immutable, append-only record of every karma points movement.
 *
 * This is the source of truth for a user's karma balance; User.karmaPoints is a
 * denormalised cache of the running sum, updated atomically alongside each entry.
 * Entries are never mutated or deleted — corrections are new `adjust`/`reverse`
 * rows, so the history always reconciles.
 *
 * type:
 *   earn    — credited on order delivery (+points)
 *   redeem  — spent at checkout (−points)
 *   reverse — undo of a prior redeem (refund) or earn (clawback) (signed)
 *   expire  — points lapsed past their expiry (−points)
 *   adjust  — manual admin correction (signed)
 *
 * `points` is signed (+credit / −debit). `balanceAfter` snapshots the resulting
 * balance for audit. The partial-unique {order, type:'earn'} index guarantees an
 * order can only ever earn once, so the delivery job is safe to retry.
 */
const KarmaLedgerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: {
    type: String,
    enum: ["earn", "redeem", "reverse", "expire", "adjust"],
    required: true
  },
  points: { type: Number, required: true },      // signed
  balanceAfter: { type: Number, required: true }, // balance after applying this entry
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "KarmaLedger", default: null },
  description: { type: String, trim: true },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

KarmaLedgerSchema.index({ user: 1, createdAt: -1 });

// Earn-once-per-order guard: makes the delivery award job idempotent on retry.
KarmaLedgerSchema.index(
  { order: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: "earn", order: { $type: "objectId" } } }
);

export default mongoose.model("KarmaLedger", KarmaLedgerSchema);
