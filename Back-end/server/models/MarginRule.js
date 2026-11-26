import mongoose from 'mongoose';

/**
 * Autobacs margin rules for supplier-listed products. Procurement/admin only.
 *
 *   key 'default'           → applies to every product without a category rule.
 *   key 'category:<id>'     → overrides the default for that category.
 *
 * targetBp = the margin the price suggestion aims for; floorBp = selling below
 * this margin needs an explicit "sell below floor" confirmation. Margin is profit
 * ÷ selling price without GST (config/supplierPortal.js). With no rows at all,
 * DEFAULT_MARGIN_BP / DEFAULT_FLOOR_BP apply.
 */
const MarginRuleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 64 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    targetBp: { type: Number, required: true, min: 0, max: 9000, validate: Number.isInteger },
    floorBp: { type: Number, required: true, min: 0, max: 9000, validate: Number.isInteger },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

MarginRuleSchema.index({ key: 1 }, { unique: true, name: 'margin_rule_key' });


export default mongoose.models.MarginRule || mongoose.model('MarginRule', MarginRuleSchema);
