import MarginRule from '../models/MarginRule.js';

/** Margin rules (models/MarginRule.js). Data access only. */
export const marginRuleKey = (categoryId) => (categoryId ? `category:${categoryId}` : 'default');

const marginRuleRepository = {
  findByKeys: (keys) => MarginRule.find({ key: { $in: keys } }).select('key targetBp floorBp').lean(),
};

export default marginRuleRepository;
