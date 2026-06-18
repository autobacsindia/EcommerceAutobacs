import AdaptiveThrottlingProfile from '../models/AdaptiveThrottlingProfile.js';

/**
 * AdaptiveThrottlingProfile data access. Passthrough to the model so query
 * chaining, the active/scheduled static helpers, and instance mutations
 * (save/deleteOne on a loaded doc) all work unchanged, while keeping the model
 * import isolated to the repository layer.
 */
class AdaptiveThrottlingProfileRepository {
  find(...args) { return AdaptiveThrottlingProfile.find(...args); }
  findById(...args) { return AdaptiveThrottlingProfile.findById(...args); }
  create(...args) { return AdaptiveThrottlingProfile.create(...args); }
  getActiveProfile(...args) { return AdaptiveThrottlingProfile.getActiveProfile(...args); }
  checkScheduledProfiles(...args) { return AdaptiveThrottlingProfile.checkScheduledProfiles(...args); }
}

export default new AdaptiveThrottlingProfileRepository();
