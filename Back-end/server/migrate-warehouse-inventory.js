import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import Warehouse from "./models/Warehouse.js";
import WarehouseInventory from "./models/WarehouseInventory.js";

dotenv.config();

/**
 * Migrate existing product stock to warehouse inventory
 * This script:
 * 1. Gets all products with stock > 0
 * 2. Creates warehouse inventory records
 * 3. Distributes stock across warehouses (or assigns to main warehouse)
 */

async function migrateInventory() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✓ Connected to MongoDB");

    // Get all warehouses
    const warehouses = await Warehouse.find({ isActive: true, operationalStatus: "active" });
    
    if (warehouses.length === 0) {
      console.error("✗ No active warehouses found. Please run seed-sample-warehouses.js first.");
      process.exit(1);
    }

    console.log(`✓ Found ${warehouses.length} active warehouses`);

    // Get all products
    const products = await Product.find({ isActive: true });
    console.log(`✓ Found ${products.length} products to migrate`);

    // Clear existing warehouse inventory
    await WarehouseInventory.deleteMany({});
    console.log("✓ Cleared existing warehouse inventory");

    let totalInventoryRecords = 0;
    let totalStockMigrated = 0;
    const inventoryRecords = [];

    // Strategy: Distribute stock across warehouses
    // For simplicity, we'll assign all stock to the first warehouse (main warehouse)
    // You can modify this to distribute stock based on geography or other logic
    const mainWarehouse = warehouses[0];

    console.log(`\n--- Migrating Stock to ${mainWarehouse.name} ---`);

    for (const product of products) {
      if (product.stock && product.stock > 0) {
        const inventoryRecord = {
          warehouse: mainWarehouse._id,
          product: product._id,
          quantity: product.stock,
          reservedQuantity: 0,
          reorderLevel: Math.max(10, Math.floor(product.stock * 0.2)), // 20% of stock as reorder level
          reorderQuantity: Math.max(50, Math.floor(product.stock * 0.5)), // 50% of stock as reorder quantity
          lastRestocked: new Date(),
          isActive: true
        };

        inventoryRecords.push(inventoryRecord);
        totalStockMigrated += product.stock;
        totalInventoryRecords++;

        if (totalInventoryRecords % 100 === 0) {
          console.log(`  Processed ${totalInventoryRecords} products...`);
        }
      }
    }

    // Bulk insert inventory records
    if (inventoryRecords.length > 0) {
      await WarehouseInventory.insertMany(inventoryRecords);
      console.log(`\n✓ Created ${totalInventoryRecords} warehouse inventory records`);
      console.log(`✓ Migrated ${totalStockMigrated} total units of stock`);
    } else {
      console.log("\n⚠ No products with stock found to migrate");
    }

    // Display migration summary
    console.log("\n--- Migration Summary ---");
    console.log(`Total Products: ${products.length}`);
    console.log(`Products with Stock: ${totalInventoryRecords}`);
    console.log(`Total Stock Units: ${totalStockMigrated}`);
    console.log(`Warehouses: ${warehouses.length}`);
    console.log(`Main Warehouse: ${mainWarehouse.name} (${mainWarehouse.code})`);

    // Get inventory summary by warehouse
    const inventorySummary = await WarehouseInventory.aggregate([
      {
        $group: {
          _id: "$warehouse",
          totalProducts: { $sum: 1 },
          totalStock: { $sum: "$quantity" }
        }
      },
      {
        $lookup: {
          from: "warehouses",
          localField: "_id",
          foreignField: "_id",
          as: "warehouseInfo"
        }
      },
      {
        $unwind: "$warehouseInfo"
      }
    ]);

    console.log("\n--- Inventory by Warehouse ---");
    for (const summary of inventorySummary) {
      console.log(`\n${summary.warehouseInfo.name} (${summary.warehouseInfo.code}):`);
      console.log(`  - Products: ${summary.totalProducts}`);
      console.log(`  - Total Stock: ${summary.totalStock} units`);
    }

    console.log("\n✓ Migration completed successfully!");
    console.log("\nNext steps:");
    console.log("1. Test product availability queries");
    console.log("2. Verify warehouse selection logic");
    console.log("3. Test stock reservation on order placement");
    
    process.exit(0);
  } catch (error) {
    console.error("✗ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateInventory();
