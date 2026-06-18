import UserLocation from '../models/UserLocation.js';

/**
 * UserLocation data access. Passthrough to the model — preserves the upsert /
 * lookup / cleanup static helpers and bulk updates while keeping the model
 * import isolated to the repository layer.
 */
class UserLocationRepository {
  upsertLocation(...args) { return UserLocation.upsertLocation(...args); }
  findByUser(...args) { return UserLocation.findByUser(...args); }
  findBySession(...args) { return UserLocation.findBySession(...args); }
  getRecentLocations(...args) { return UserLocation.getRecentLocations(...args); }
  updateMany(...args) { return UserLocation.updateMany(...args); }
  cleanupExpired(...args) { return UserLocation.cleanupExpired(...args); }
}

export default new UserLocationRepository();
