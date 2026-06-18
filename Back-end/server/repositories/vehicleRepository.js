import Vehicle from '../models/Vehicle.js';

/**
 * Vehicle data access. Passthrough to the model so existing query chaining is
 * preserved exactly, while keeping the model import isolated to the repository
 * layer.
 */
class VehicleRepository {
  find(...args) { return Vehicle.find(...args); }
  findOne(...args) { return Vehicle.findOne(...args); }
  findById(...args) { return Vehicle.findById(...args); }
  findByIdAndUpdate(...args) { return Vehicle.findByIdAndUpdate(...args); }
  countDocuments(...args) { return Vehicle.countDocuments(...args); }
  distinct(...args) { return Vehicle.distinct(...args); }
  create(...args) { return Vehicle.create(...args); }
}

export default new VehicleRepository();
