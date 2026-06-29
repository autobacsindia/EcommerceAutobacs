import LoyaltyConfig from '../models/LoyaltyConfig.js';

class LoyaltyConfigRepository {
  async getSingleton() {
    return LoyaltyConfig.getSingleton();
  }

  async update(set) {
    return LoyaltyConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: set },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }
}

export default new LoyaltyConfigRepository();
