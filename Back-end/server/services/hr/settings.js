/**
 * Company HR settings (models/hr/HrSettings.js): one document, key 'default'.
 * `getHrSettings()` always returns a complete object (schema defaults when the
 * document doesn't exist yet), so callers never branch on "not configured".
 */
import hrSettingsRepository from '../../repositories/hr/hrSettingsRepository.js';
import { DEFAULT_ONBOARDING_ITEMS } from '../../config/hr.js';
import AppError from '../../utils/AppError.js';
import { recordHrAudit, diffFields } from './audit.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

// What HR/admin may change from the panel. Everything else is fixed by code.
const EDITABLE = [
  'faceMatchThreshold', 'gpsMaxAccuracyM', 'offlineMaxHours', 'maxFaceAttempts', 'faceReviewPhotoDays',
  'deviceChangeCooldownDays', 'autoCloseTime', 'leaveHeadStep', 'monthDayBasis', 'payday',
  'pfEmployeeRate', 'pfEmployerRate', 'pfWageCeilingPaise', 'esiEmployeeRate', 'esiEmployerRate',
  'esiGrossThresholdPaise', 'ptSlabs', 'includeIncentives', 'onboardingItems',
];

const plain = (doc) => {
  const o = doc.toObject ? doc.toObject({ flattenMaps: true }) : doc;
  const { _id: _ignoredId, __v: _ignoredV, key: _ignoredKey, ...rest } = o;
  if (!rest.onboardingItems || !rest.onboardingItems.length) rest.onboardingItems = DEFAULT_ONBOARDING_ITEMS.map((i) => ({ ...i }));
  if (rest.ptSlabs instanceof Map) rest.ptSlabs = Object.fromEntries(rest.ptSlabs);
  return rest;
};

export async function getHrSettings() {
  return plain(hrSettingsRepository.hydrate(await hrSettingsRepository.findDefault()));
}

/** Partial update with CAS on `rev`. Validation is the schema's (min/max/enum). */
export async function updateHrSettings(actor, input, { rev, reason = '', req = null } = {}) {
  const set = {};
  for (const k of EDITABLE) if (input[k] !== undefined) set[k] = input[k];
  if (!Object.keys(set).length) throw fail('Nothing to change', 400);

  const before = await getHrSettings();
  if (rev !== undefined && Number(rev) !== (before.rev || 0)) {
    throw fail('Settings were changed by someone else since you opened them. Reload and try again.', 409);
  }
  // Validate against the schema before writing (findOneAndUpdate runValidators misses Map/array subtleties).
  await hrSettingsRepository.validate({ ...before, ...set });

  const expectedRev = rev !== undefined ? Number(rev) || 0 : before.rev || 0;
  const updated = await hrSettingsRepository.updateIfRev(
    expectedRev,
    { ...set, updatedBy: actor._id },
    { allowCreate: expectedRev === 0 },
  ).catch((err) => {
    if (err?.code === 11000) return null; // lost the upsert race
    throw err;
  });
  if (!updated) throw fail('Settings were changed by someone else since you opened them. Reload and try again.', 409);

  await recordHrAudit({
    action: 'settings.updated', entity: 'HrSettings', entityId: updated._id, actor, reason, req,
    changes: diffFields(before, set),
  });
  return plain(updated);
}
