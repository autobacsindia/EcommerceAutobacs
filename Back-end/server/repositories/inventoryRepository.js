import BaseRepository from './baseRepository.js';
import WarehouseInventory from '../models/WarehouseInventory.js';

class InventoryRepository extends BaseRepository {
  constructor() {
    super(WarehouseInventory);
  }

  async findByWarehouseAndProduct(warehouseId, productId, session = null) {
    let q = WarehouseInventory.findOne({
      warehouse: warehouseId,
      product: productId,
      isActive: true
    });
    if (session) q = q.session(session);
    return q;
  }

  async findByWarehouse(warehouseId, options = {}) {
    const { limit = 50, skip = 0, session = null } = options;
    let q = WarehouseInventory.find({ warehouse: warehouseId, isActive: true })
      .populate('product', 'name sku price images')
      .skip(skip)
      .limit(limit);
    if (session) q = q.session(session);
    return q;
  }

  async findByProduct(productId, session = null) {
    let q = WarehouseInventory.find({ product: productId, isActive: true })
      .populate('warehouse', 'name location');
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Atomically deduct stock with an availability guard.
   * Returns the old document if successful, null if quantity was insufficient.
   * Inside a transaction the caller's session is used — do NOT manually rollback;
   * the transaction abort handles it automatically.
   */
  async atomicDeduct(warehouseId, productId, quantity, session = null) {
    return WarehouseInventory.findOneAndUpdate(
      {
        warehouse: warehouseId,
        product: productId,
        isActive: true,
        quantity: { $gte: quantity }
      },
      { $inc: { quantity: -quantity } },
      { new: false, ...(session && { session }) }
    );
  }

  async adjustQuantity(warehouseId, productId, delta, session = null) {
    return WarehouseInventory.findOneAndUpdate(
      { warehouse: warehouseId, product: productId, isActive: true },
      { $inc: { quantity: delta } },
      { new: true, ...(session && { session }) }
    );
  }

  async findLowStock(warehouseId, session = null) {
    const query = {
      isActive: true,
      $expr: { $lte: ['$quantity', '$reorderLevel'] }
    };
    if (warehouseId) query.warehouse = warehouseId;
    let q = WarehouseInventory.find(query)
      .populate('product', 'name sku')
      .populate('warehouse', 'name');
    if (session) q = q.session(session);
    return q;
  }

  async upsert(warehouseId, productId, data, session = null) {
    return WarehouseInventory.findOneAndUpdate(
      { warehouse: warehouseId, product: productId },
      { $set: { ...data, warehouse: warehouseId, product: productId } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        ...(session && { session })
      }
    );
  }

  async save(doc, session = null) {
    if (session) return doc.save({ session });
    return doc.save();
  }
}

export default new InventoryRepository();
