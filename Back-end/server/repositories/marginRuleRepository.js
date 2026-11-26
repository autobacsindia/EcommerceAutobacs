import MarginRule from '../models/MarginRule.js';

/** Margin rules (models/MarginRule.js). Data access only. */
export const marginRuleKey = (categoryId) => (categoryId ? `category:${categoryId}` : 'default');

const marginRuleRepository = {
  findByKeys: (keys) => MarginRule.find({ key: { $in: keys } }).select('key targetBp floorBp').lean(),

  // ── Procurement edits (services/procurementPartners/marginRules.js) ──
  /** Every rule (one per category at most + the default; bounded by `limit`). */
  listAll: (limit = 1000) => MarginRule.find({}).select('key category targetBp floorBp updatedByName updatedAt').sort({ key: 1 }).limit(limit).lean(),
  upsert: (key, set) => MarginRule.findOneAndUpdate({ key }, { $set: { key, ...set } }, { upsert: true, new: true, runValidators: true }).lean(),
  deleteByKey: (key) => MarginRule.deleteOne({ key }),
};

export default marginRuleRepository;
