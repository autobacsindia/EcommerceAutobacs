import mongoose from "mongoose";

const WarehouseInventorySchema = new mongoose.Schema({
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Warehouse",
    required: [true, "Warehouse reference is required"]
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product reference is required"]
  },
  quantity: {
    type: Number,
    required: true,
    min: [0, "Quantity cannot be negative"],
    default: 0
  },
  reservedQuantity: {
    type: Number,
    default: 0,
    min: [0, "Reserved quantity cannot be negative"]
  },
  reorderLevel: {
    type: Number,
    default: 10,
    min: [0, "Reorder level cannot be negative"]
  },
  reorderQuantity: {
    type: Number,
    default: 50,
    min: [0, "Reorder quantity cannot be negative"]
  },
  lastRestocked: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  location: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index for warehouse-product uniqueness
WarehouseInventorySchema.index({ warehouse: 1, product: 1 }, { unique: true });

// Indexes for common queries
WarehouseInventorySchema.index({ warehouse: 1, isActive: 1 });
WarehouseInventorySchema.index({ product: 1, isActive: 1 });
WarehouseInventorySchema.index({ quantity: 1 });
WarehouseInventorySchema.index({ reorderLevel: 1 });

// Virtual for available quantity
WarehouseInventorySchema.virtual("availableQuantity").get(function() {
  return Math.max(0, this.quantity - this.reservedQuantity);
});

// Method to check if stock is low
WarehouseInventorySchema.methods.isLowStock = function() {
  return this.quantity <= this.reorderLevel;
};

// Method to check if product is in stock
WarehouseInventorySchema.methods.isInStock = function() {
  return this.availableQuantity > 0;
};

// Method to reserve stock
WarehouseInventorySchema.methods.reserveStock = async function(quantity) {
  if (this.availableQuantity < quantity) {
    throw new Error("Insufficient stock available");
  }
  this.reservedQuantity += quantity;
  await this.save();
  return this;
};

// Method to release reserved stock
WarehouseInventorySchema.methods.releaseStock = async function(quantity) {
  this.reservedQuantity = Math.max(0, this.reservedQuantity - quantity);
  await this.save();
  return this;
};

// Method to decrement stock (on order shipment)
WarehouseInventorySchema.methods.decrementStock = async function(quantity) {
  if (this.quantity < quantity) {
    throw new Error("Insufficient stock to decrement");
  }
  this.quantity -= quantity;
  this.reservedQuantity = Math.max(0, this.reservedQuantity - quantity);
  await this.save();
  return this;
};

// Method to increment stock (on restock)
WarehouseInventorySchema.methods.incrementStock = async function(quantity) {
  this.quantity += quantity;
  this.lastRestocked = new Date();
  await this.save();
  return this;
};

// Static method to get total stock for a product across all warehouses
WarehouseInventorySchema.statics.getTotalStock = async function(productId) {
  const result = await this.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(productId),
        isActive: true
      }
    },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: "$quantity" },
        totalReserved: { $sum: "$reservedQuantity" }
      }
    }
  ]);
  
  if (result.length === 0) {
    return { totalQuantity: 0, totalReserved: 0, available: 0 };
  }
  
  return {
    totalQuantity: result[0].totalQuantity,
    totalReserved: result[0].totalReserved,
    available: result[0].totalQuantity - result[0].totalReserved
  };
};

// Static method to find warehouses with stock for a product
WarehouseInventorySchema.statics.findWarehousesWithStock = async function(productId, minQuantity = 1) {
  return this.find({
    product: productId,
    isActive: true,
    $expr: { $gte: [{ $subtract: ["$quantity", "$reservedQuantity"] }, minQuantity] }
  }).populate("warehouse");
};

// Static method to get low stock items for a warehouse
WarehouseInventorySchema.statics.getLowStockItems = async function(warehouseId) {
  return this.find({
    warehouse: warehouseId,
    isActive: true,
    $expr: { $lte: ["$quantity", "$reorderLevel"] }
  }).populate("product");
};

export default mongoose.model("WarehouseInventory", WarehouseInventorySchema);
