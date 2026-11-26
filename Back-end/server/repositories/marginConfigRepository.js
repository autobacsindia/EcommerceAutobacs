import MarginConfig, { MARGIN_MIN_BP_MAX } from '../models/MarginConfig.js';

export { MARGIN_MIN_BP_MAX };

/** The one minimum-margin settings document (models/MarginConfig.js). Data access only. */
const marginConfigRepository = {
  get: () => MarginConfig.findOne({ key: 'default' }).select('minBp updatedByName updatedAt').lean(),
  setMinBp: (minBp, by) => MarginConfig.findOneAndUpdate(
    { key: 'default' },
    { $set: { minBp, updatedBy: by._id, updatedByName: by.name || '' } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean(),
};

export default marginConfigRepository;
