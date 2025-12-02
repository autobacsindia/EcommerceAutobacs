import Warehouse from "../models/Warehouse.js";
import WarehouseInventory from "../models/WarehouseInventory.js";
import Product from "../models/Product.js";
import googleMapsService from "./googleMapsService.js";

/**
 * Warehouse Service for managing warehouses and inventory
 */
class WarehouseService {
  /**
   * Create a new warehouse
   * @param {Object} warehouseData - Warehouse details
   * @returns {Promise<Object>} Created warehouse
   */
  async createWarehouse(warehouseData) {
    try {
      // Validate and geocode if coordinates not provided
      if (!warehouseData.location.coordinates) {
        const address = `${warehouseData.location.address}, ${warehouseData.location.city}, ${warehouseData.location.state} ${warehouseData.location.postalCode}`;
        const geocoded = await googleMapsService.geocodeAddress(address);
        
        warehouseData.location.coordinates = {
          type: "Point",
          coordinates: [geocoded.coordinates.longitude, geocoded.coordinates.latitude]
        };
      }

      const warehouse = new Warehouse(warehouseData);
      await warehouse.save();
      return warehouse;
    } catch (error) {
      console.error("Create warehouse error:", error);
      throw error;
    }
  }

  /**
   * Get all warehouses with optional filters
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} List of warehouses
   */
  async getAllWarehouses(filters = {}) {
    try {
      const query = { isActive: true };

      if (filters.status) {
        query.operationalStatus = filters.status;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.city) {
        query["location.city"] = filters.city;
      }

      const warehouses = await Warehouse.find(query).sort({ createdAt: -1 });
      return warehouses;
    } catch (error) {
      console.error("Get warehouses error:", error);
      throw error;
    }
  }

  /**
   * Get warehouse by ID
   * @param {string} warehouseId 
   * @returns {Promise<Object>} Warehouse details
   */
  async getWarehouseById(warehouseId) {
    try {
      const warehouse = await Warehouse.findById(warehouseId);
      
      if (!warehouse) {
        throw new Error("Warehouse not found");
      }

      return warehouse;
    } catch (error) {
      console.error("Get warehouse by ID error:", error);
      throw error;
    }
  }

  /**
   * Update warehouse
   * @param {string} warehouseId 
   * @param {Object} updateData 
   * @returns {Promise<Object>} Updated warehouse
   */
  async updateWarehouse(warehouseId, updateData) {
    try {
      // If location address changed, re-geocode
      if (updateData.location && !updateData.location.coordinates) {
        const address = `${updateData.location.address}, ${updateData.location.city}, ${updateData.location.state} ${updateData.location.postalCode}`;
        const geocoded = await googleMapsService.geocodeAddress(address);
        
        updateData.location.coordinates = {
          type: "Point",
          coordinates: [geocoded.coordinates.longitude, geocoded.coordinates.latitude]
        };
      }

      const warehouse = await Warehouse.findByIdAndUpdate(
        warehouseId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!warehouse) {
        throw new Error("Warehouse not found");
      }

      return warehouse;
    } catch (error) {
      console.error("Update warehouse error:", error);
      throw error;
    }
  }

  /**
   * Delete warehouse (soft delete)
   * @param {string} warehouseId 
   * @returns {Promise<boolean>} Success status
   */
  async deleteWarehouse(warehouseId) {
    try {
      const warehouse = await Warehouse.findByIdAndUpdate(
        warehouseId,
        { isActive: false, operationalStatus: "inactive" },
        { new: true }
      );

      if (!warehouse) {
        throw new Error("Warehouse not found");
      }

      return true;
    } catch (error) {
      console.error("Delete warehouse error:", error);
      throw error;
    }
  }

  /**
   * Get warehouse inventory with pagination
   * @param {string} warehouseId 
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} Inventory list with pagination
   */
  async getWarehouseInventory(warehouseId, options = {}) {
    try {
      const page = parseInt(options.page) || 1;
      const limit = parseInt(options.limit) || 20;
      const skip = (page - 1) * limit;

      const query = {
        warehouse: warehouseId,
        isActive: true
      };

      if (options.productId) {
        query.product = options.productId;
      }

      if (options.lowStock) {
        query.$expr = { $lte: ["$quantity", "$reorderLevel"] };
      }

      const [inventory, total] = await Promise.all([
        WarehouseInventory.find(query)
          .populate("product")
          .sort({ quantity: 1 })
          .skip(skip)
          .limit(limit),
        WarehouseInventory.countDocuments(query)
      ]);

      return {
        inventory,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error("Get warehouse inventory error:", error);
      throw error;
    }
  }

  /**
   * Update warehouse stock for a product
   * @param {string} warehouseId 
   * @param {string} productId 
   * @param {Object} stockData - { quantity, operation }
   * @returns {Promise<Object>} Updated inventory
   */
  async updateWarehouseStock(warehouseId, productId, stockData) {
    try {
      let inventory = await WarehouseInventory.findOne({
        warehouse: warehouseId,
        product: productId
      });

      if (!inventory) {
        // Create new inventory record if doesn't exist
        inventory = new WarehouseInventory({
          warehouse: warehouseId,
          product: productId,
          quantity: 0,
          reservedQuantity: 0
        });
      }

      // Perform operation
      const { quantity, operation = "set" } = stockData;

      switch (operation) {
        case "set":
          inventory.quantity = quantity;
          break;
        case "increment":
          await inventory.incrementStock(quantity);
          break;
        case "decrement":
          await inventory.decrementStock(quantity);
          break;
        case "reserve":
          await inventory.reserveStock(quantity);
          break;
        case "release":
          await inventory.releaseStock(quantity);
          break;
        default:
          throw new Error(`Invalid operation: ${operation}`);
      }

      if (operation === "set") {
        await inventory.save();
      }

      return inventory;
    } catch (error) {
      console.error("Update warehouse stock error:", error);
      throw error;
    }
  }

  /**
   * Get product availability across all warehouses
   * @param {string} productId 
   * @returns {Promise<Object>} Availability details
   */
  async getProductAvailability(productId) {
    try {
      const warehouses = await WarehouseInventory.findWarehousesWithStock(productId);
      const totalStock = await WarehouseInventory.getTotalStock(productId);

      return {
        totalStock: totalStock.totalQuantity,
        available: totalStock.available,
        reserved: totalStock.totalReserved,
        warehouses: warehouses.map(inv => ({
          warehouse: inv.warehouse,
          quantity: inv.quantity,
          reservedQuantity: inv.reservedQuantity,
          available: inv.availableQuantity
        })),
        inStock: totalStock.available > 0
      };
    } catch (error) {
      console.error("Get product availability error:", error);
      throw error;
    }
  }

  /**
   * Select optimal warehouse for order fulfillment
   * @param {Array} orderItems - Order items with productId and quantity
   * @param {Object} deliveryAddress - Delivery address with coordinates
   * @returns {Promise<Object>} Selected warehouse and availability
   */
  async selectWarehouseForOrder(orderItems, deliveryAddress) {
    try {
      const { coordinates, postalCode } = deliveryAddress;

      // Get all active warehouses
      const warehouses = await Warehouse.find({
        operationalStatus: "active",
        isActive: true
      });

      // Calculate scores for each warehouse
      const warehouseScores = [];

      for (const warehouse of warehouses) {
        // Check if warehouse services this PIN code
        if (warehouse.serviceablePinCodes.length > 0 && 
            !warehouse.servicesPinCode(postalCode)) {
          continue;
        }

        // Check inventory availability
        let hasAllProducts = true;
        const warehouseInventory = [];

        for (const item of orderItems) {
          const inventory = await WarehouseInventory.findOne({
            warehouse: warehouse._id,
            product: item.productId,
            isActive: true
          });

          if (!inventory || inventory.availableQuantity < item.quantity) {
            hasAllProducts = false;
            break;
          }

          warehouseInventory.push(inventory);
        }

        if (!hasAllProducts) {
          continue;
        }

        // Calculate distance
        const distance = googleMapsService.calculateDistance(
          coordinates.latitude,
          coordinates.longitude,
          warehouse.location.coordinates.coordinates[1],
          warehouse.location.coordinates.coordinates[0]
        );

        warehouseScores.push({
          warehouse,
          distance,
          inventory: warehouseInventory,
          score: -distance // Negative distance for ascending sort
        });
      }

      // Sort by score (nearest first)
      warehouseScores.sort((a, b) => b.score - a.score);

      if (warehouseScores.length === 0) {
        return {
          available: false,
          message: "No warehouse has complete stock for this order"
        };
      }

      const selected = warehouseScores[0];

      return {
        available: true,
        warehouse: selected.warehouse,
        distance: selected.distance,
        distanceKm: (selected.distance / 1000).toFixed(2),
        inventory: selected.inventory
      };
    } catch (error) {
      console.error("Select warehouse for order error:", error);
      throw error;
    }
  }

  /**
   * Get low stock alerts for a warehouse
   * @param {string} warehouseId 
   * @returns {Promise<Array>} Low stock items
   */
  async getLowStockAlerts(warehouseId) {
    try {
      return await WarehouseInventory.getLowStockItems(warehouseId);
    } catch (error) {
      console.error("Get low stock alerts error:", error);
      throw error;
    }
  }

  /**
   * Find nearest warehouse to coordinates
   * @param {number} latitude 
   * @param {number} longitude 
   * @param {number} maxDistance - Maximum distance in meters
   * @returns {Promise<Object>} Nearest warehouse
   */
  async findNearestWarehouse(latitude, longitude, maxDistance = 50000) {
    try {
      const warehouses = await Warehouse.findNearest(longitude, latitude, maxDistance);
      
      if (warehouses.length === 0) {
        return null;
      }

      return warehouses[0];
    } catch (error) {
      console.error("Find nearest warehouse error:", error);
      throw error;
    }
  }
}

export default new WarehouseService();
