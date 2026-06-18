import Warehouse from '../models/Warehouse.js';

/**
 * Warehouse data access. Passthrough to the model so query chaining, the
 * findNearest static, and instance save() on a freshly built doc all work
 * unchanged, while keeping the model import isolated to the repository layer.
 */
class WarehouseRepository {
  find(...args) { return Warehouse.find(...args); }
  findById(...args) { return Warehouse.findById(...args); }
  findByIdAndUpdate(...args) { return Warehouse.findByIdAndUpdate(...args); }
  findNearest(...args) { return Warehouse.findNearest(...args); }
  /** Build an unsaved document; caller mutates then save()s it. */
  build(data) { return new Warehouse(data); }
}

export default new WarehouseRepository();
