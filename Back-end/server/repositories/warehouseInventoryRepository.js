import WarehouseInventory from '../models/WarehouseInventory.js';

/**
 * WarehouseInventory data access. Passthrough to the model — preserves query
 * chaining, the stock-aggregation static helpers, and instance save() on a
 * freshly built doc, while keeping the model import isolated to the repository
 * layer.
 */
class WarehouseInventoryRepository {
  find(...args) { return WarehouseInventory.find(...args); }
  findOne(...args) { return WarehouseInventory.findOne(...args); }
  findOneAndUpdate(...args) { return WarehouseInventory.findOneAndUpdate(...args); }
  countDocuments(...args) { return WarehouseInventory.countDocuments(...args); }
  findWarehousesWithStock(...args) { return WarehouseInventory.findWarehousesWithStock(...args); }
  getTotalStock(...args) { return WarehouseInventory.getTotalStock(...args); }
  getLowStockItems(...args) { return WarehouseInventory.getLowStockItems(...args); }
  /** Build an unsaved document; caller mutates then save()s it. */
  build(data) { return new WarehouseInventory(data); }
}

export default new WarehouseInventoryRepository();
