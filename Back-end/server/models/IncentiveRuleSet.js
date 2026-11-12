import mongoose from 'mongoose';

/**
 * Roav Points rules, versioned (services/incentives/ruleService.js).
 *
 * A version is NEVER edited after it is saved — a change is a new version. Each
 * version says the first month it governs (`effectiveFrom`, 'YYYY-MM', IST), and
 * a new one may only start NEXT month or later, so a saved change can never
 * reach back into a month that has already earned points. The rules for a month
 * are the highest version whose effectiveFrom ≤ that month.
 */
const IncentiveRuleSetSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    note: { type: String, default: '', maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true, minimize: false }
);

// Same names and options as config/db.js ensureCriticalIndexes (prod has autoIndex off).
IncentiveRuleSetSchema.index({ version: 1 }, { unique: true, name: 'incentive_rules_version' });
IncentiveRuleSetSchema.index({ effectiveFrom: -1, version: -1 }, { name: 'incentive_rules_effective' });

export default mongoose.model('IncentiveRuleSet', IncentiveRuleSetSchema);
