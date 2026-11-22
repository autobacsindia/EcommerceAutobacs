import ReimbursementConfig, { REIMBURSEMENT_DEFAULTS, FUEL_RATE_MAX } from '../models/ReimbursementConfig.js';

export { REIMBURSEMENT_DEFAULTS, FUEL_RATE_MAX };

/** The one reimbursement settings document (models/ReimbursementConfig.js). Data access only. */
const reimbursementConfigRepository = {
  find: () => ReimbursementConfig.findOne({ key: 'default' }).lean(),
  /** Set fields on it, making it first if it does not exist yet. */
  upsert: (set) => ReimbursementConfig.findOneAndUpdate(
    { key: 'default' }, { $set: set }, { upsert: true, setDefaultsOnInsert: true, new: true, runValidators: true },
  ).lean(),
};

export default reimbursementConfigRepository;
