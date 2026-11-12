import mongoose from 'mongoose';

/**
 * One Roav Points month (IST calendar month) and its close.
 *
 *   open      — points are still landing (the default; a month with no row is open).
 *   locked    — closed at the month end. `statements` is the computed snapshot,
 *               waiting for admin review. New earns/reversals for this month now
 *               land in the CURRENT month instead.
 *   approved  — an admin checked and approved it; the CSV for payroll unlocks.
 *
 * Re-opening (locked/approved → open) is an admin action with a reason; it is
 * kept in `history` and the audit log, and clears the snapshot so the next lock
 * recomputes it.
 */
const StatementSchema = new mongoose.Schema({
  earnerKey: { type: String, required: true },
  earnerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  earnerRep: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesRep', default: null },
  name: { type: String, default: '' },
  orders: Number,
  returnedOrders: Number,
  ratingCount: Number,
  ratingAvg: { type: Number, default: null },
  centi: Number,
  flatCenti: Number,
  ledgerPoints: Number,
  returnRate: Number,
  returnFactor: Number,
  ratingFactor: Number,
  finalPoints: Number,
  slab: { type: String, default: null },
  ratePerPoint: Number,
  payoutPaise: Number,
  multipliersDropped: Boolean,
}, { _id: false });

const HistorySchema = new mongoose.Schema({
  action: { type: String, enum: ['locked', 'approved', 'reopened'], required: true },
  at: { type: Date, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: 'system' },
  reason: { type: String, default: '' },
}, { _id: false });

const IncentiveMonthSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ['open', 'locked', 'approved'], default: 'open' },
    rulesVersion: { type: Number, default: null },
    lockedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Σ ledger centi at lock — approve refuses if the ledger moved since.
    ledgerCentiAtLock: { type: Number, default: null },
    ledgerRowsAtLock: { type: Number, default: null },
    statements: { type: [StatementSchema], default: [] },
    totalPayoutPaise: { type: Number, default: 0 },
    champion: {
      type: new mongoose.Schema({
        earnerKey: String, name: String, finalPoints: Number, payoutPaise: Number,
        slab: String, ratingAvg: Number,
      }, { _id: false }),
      default: null,
    },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

IncentiveMonthSchema.index({ month: 1 }, { unique: true, name: 'incentive_month_unique' });

export default mongoose.model('IncentiveMonth', IncentiveMonthSchema);
