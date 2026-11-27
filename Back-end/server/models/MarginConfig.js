import mongoose from 'mongoose';
import { DEFAULT_BUY_MIN_BP } from '../config/supplierPortal.js';

/**
 * MarginConfig — the admin's minimum margin on what procurement buys for an order.
 * One document (key "default"). Admin-only: procurement edits the supplier-app
 * pricing rules (MarginRule), never this one — it is the check on procurement.
 *
 *   minBp  basis points (3000 = 30%). A supplier payment for an order whose margin
 *          is below this needs a reason and accounts' approval. Each payment keeps the
 *          minimum it was checked against (PaymentRequest.margin.minBp), so changing
 *          this affects new payments only.
 */
export const MARGIN_MIN_BP_MAX = 9000;

const MarginConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true, immutable: true },
    minBp: { type: Number, default: DEFAULT_BUY_MIN_BP, min: 0, max: MARGIN_MIN_BP_MAX, validate: Number.isInteger },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true, collection: 'marginconfig' },
);

export default mongoose.models.MarginConfig || mongoose.model('MarginConfig', MarginConfigSchema);
