/** Company HR settings (models/hr/HrSettings.js): one document, key 'default'. */
import HrSettings from '../../models/hr/HrSettings.js';

export const HR_SETTINGS_KEY = 'default';

const hrSettingsRepository = {
  findDefault: () => HrSettings.findOne({ key: HR_SETTINGS_KEY }).lean(),
  /** A full document (schema defaults applied) from a lean row, or a fresh default. */
  hydrate: (row) => (row ? HrSettings.hydrate(row) : new HrSettings({ key: HR_SETTINGS_KEY })),
  /** Throws a mongoose ValidationError when `values` break the schema. */
  validate: (values) => new HrSettings({ ...values, key: HR_SETTINGS_KEY }).validate(),
  /** CAS on rev; upserts only when `allowCreate`. Returns the new doc or null. */
  updateIfRev: (rev, set, { allowCreate }) => HrSettings.findOneAndUpdate(
    { key: HR_SETTINGS_KEY, rev },
    { $set: set, $inc: { rev: 1 } },
    { new: true, upsert: allowCreate, runValidators: true },
  ),
};

export default hrSettingsRepository;
