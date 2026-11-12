import mongoose from 'mongoose';

/**
 * Per-order Roav Points inputs an admin sets by hand — today only "special
 * sourcing" (air-urgent or sub-dealer, earns 75%), because no order field
 * records it. Kept OFF the Order document on purpose: the order is the customer's
 * financial record and other sessions own its writes.
 *
 * `rev` bumps on every change. The ledger keys its earn rows by revision, so a
 * change after the order already earned is applied as "reverse rev N, earn rev
 * N+1" — never by rewriting a row.
 */
const IncentiveOrderFlagSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    specialSourcing: { type: Boolean, default: false },
    rev: { type: Number, default: 0 },
    note: { type: String, default: '', maxlength: 300 },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    setByName: { type: String, default: '' },
  },
  { timestamps: true }
);

IncentiveOrderFlagSchema.index({ order: 1 }, { unique: true, name: 'incentive_flag_order' });

export default mongoose.model('IncentiveOrderFlag', IncentiveOrderFlagSchema);
