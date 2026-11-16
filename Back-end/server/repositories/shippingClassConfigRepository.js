import ShippingClassConfig from '../models/ShippingClassConfig.js';

/** The singleton standard-box settings (key "default"). */
class ShippingClassConfigRepository {
  /** Read-only: null when nobody has saved boxes yet (callers fall back to the defaults). */
  async find() {
    return ShippingClassConfig.findOne({ key: 'default' }).select('boxes updatedAt').lean();
  }

  async saveBoxes(boxes, userId) {
    return ShippingClassConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: { boxes, updatedBy: userId ?? null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, projection: { boxes: 1, updatedAt: 1 } },
    ).lean();
  }
}

export default new ShippingClassConfigRepository();
