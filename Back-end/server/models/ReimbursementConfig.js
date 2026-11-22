import mongoose from 'mongoose';

/**
 * ReimbursementConfig — the admin's settings for staff reimbursements. One
 * document (key "default"), read through services/reimbursement.js.
 *
 *   fuelRatePerKm   rupees paid per km of a Fuel claim (default ₹15). A claim
 *                   keeps the rate it was submitted with (PaymentRequest
 *                   .reimbursement.ratePerKm): changing this affects new claims only.
 */
export const REIMBURSEMENT_DEFAULTS = Object.freeze({ fuelRatePerKm: 15 });
/** A typo guard on the rate, in rupees per km. */
export const FUEL_RATE_MAX = 100;

const ReimbursementConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true, immutable: true },
    fuelRatePerKm: { type: Number, default: REIMBURSEMENT_DEFAULTS.fuelRatePerKm, min: 0.01, max: FUEL_RATE_MAX },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true, collection: 'reimbursementconfig' },
);

export default mongoose.models.ReimbursementConfig || mongoose.model('ReimbursementConfig', ReimbursementConfigSchema);
