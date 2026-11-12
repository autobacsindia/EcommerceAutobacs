import mongoose from 'mongoose';

/**
 * Roav Points ledger — one IMMUTABLE row per earned (or reversed) piece of points.
 *
 * Rows are only ever INSERTED. Nothing updates or deletes one: a return writes a
 * second row with the negative points (`type: 'reverse'`, `reverses` = the earn's
 * key), and a re-computation of an order (special-sourcing toggled) reverses the
 * old rows and earns a new revision.
 *
 * `key` is the idempotency handle and is UNIQUE:
 *   earn:<order>:r<rev>:<component>:<line|order>:<earner>
 *   rev:<earn key>
 * so a webhook retry, a cron overlap or a re-run inserts nothing new — the
 * duplicate-key error is the "already done" answer.
 *
 * `inputs` snapshots everything the points were computed from (ex-GST value,
 * discount %, keep, multiplier portions, flags, rule version), so a statement
 * can be explained years later without reading live orders or rules.
 *
 * Points are INTEGER CENTI-POINTS (100 = 1 point) — see pointsMath.js.
 */
const IncentiveLedgerEntrySchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    type: { type: String, enum: ['earn', 'reverse'], required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },

    // Who is credited. `earnerKey` is 'u:<userId>' (a staff login) or 'r:<salesRepId>'
    // (a name-only CRM rep with no login).
    earnerKey: { type: String, required: true },
    earnerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    earnerRep: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesRep', default: null },
    earnerName: { type: String, default: '' },
    share: { type: Number, required: true, min: 0, max: 1 },

    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, default: '' },
    rev: { type: Number, default: 0 },
    lineId: { type: String, default: null },
    component: { type: String, required: true }, // core | order | bonus:<key>

    centi: { type: Number, required: true },     // points × 100, after this earner's share
    flatCenti: { type: Number, required: true }, // same, without invoice multipliers

    rulesVersion: { type: Number, required: true },
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },

    // When it happened in the business sense: payment time for an earn, the
    // return/refund time for a reversal.
    eventAt: { type: Date, required: true },
    reverses: { type: String, default: null },
    reason: { type: String, default: null }, // return | refund | cancel | recompute
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

// Same names and options as config/db.js ensureCriticalIndexes.
IncentiveLedgerEntrySchema.index({ key: 1 }, { unique: true, name: 'incentive_ledger_key' });
IncentiveLedgerEntrySchema.index({ month: 1, earnerKey: 1, _id: 1 }, { name: 'incentive_ledger_month_earner' });
IncentiveLedgerEntrySchema.index({ order: 1, type: 1 }, { name: 'incentive_ledger_order' });

// Ledger rows are append-only. Block the obvious mutation paths so a future
// caller gets an error rather than silently rewriting a payroll record.
const immutable = function (next) { next(new Error('IncentiveLedgerEntry is append-only')); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  IncentiveLedgerEntrySchema.pre(op, immutable);
}
IncentiveLedgerEntrySchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('IncentiveLedgerEntry is append-only'));
  next();
});

export default mongoose.model('IncentiveLedgerEntry', IncentiveLedgerEntrySchema);
