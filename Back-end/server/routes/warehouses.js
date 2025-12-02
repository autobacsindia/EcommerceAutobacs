import express from "express";
import warehouseService from "../services/warehouseService.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @route   GET /api/warehouses
 * @desc    Get all warehouses
 * @access  Private/Admin
 */
router.get("/", protect, admin, async (req, res) => {
  try {
    const { status, type, city } = req.query;
    const filters = { status, type, city };
    
    const warehouses = await warehouseService.getAllWarehouses(filters);

    res.status(200).json({
      success: true,
      count: warehouses.length,
      warehouses
    });
  } catch (error) {
    console.error("Get warehouses error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get warehouses"
    });
  }
});

/**
 * @route   POST /api/warehouses
 * @desc    Create new warehouse
 * @access  Private/Admin
 */
router.post("/", protect, admin, async (req, res) => {
  try {
    const warehouse = await warehouseService.createWarehouse(req.body);

    res.status(201).json({
      success: true,
      warehouse
    });
  } catch (error) {
    console.error("Create warehouse error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to create warehouse"
    });
  }
});

/**
 * @route   GET /api/warehouses/:id
 * @desc    Get warehouse by ID
 * @access  Private/Admin
 */
router.get("/:id", protect, admin, async (req, res) => {
  try {
    const warehouse = await warehouseService.getWarehouseById(req.params.id);

    res.status(200).json({
      success: true,
      warehouse
    });
  } catch (error) {
    console.error("Get warehouse error:", error);
    res.status(404).json({
      success: false,
      message: error.message || "Warehouse not found"
    });
  }
});

/**
 * @route   PUT /api/warehouses/:id
 * @desc    Update warehouse
 * @access  Private/Admin
 */
router.put("/:id", protect, admin, async (req, res) => {
  try {
    const warehouse = await warehouseService.updateWarehouse(req.params.id, req.body);

    res.status(200).json({
      success: true,
      warehouse
    });
  } catch (error) {
    console.error("Update warehouse error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update warehouse"
    });
  }
});

/**
 * @route   DELETE /api/warehouses/:id
 * @desc    Delete warehouse
 * @access  Private/Admin
 */
router.delete("/:id", protect, admin, async (req, res) => {
  try {
    await warehouseService.deleteWarehouse(req.params.id);

    res.status(200).json({
      success: true,
      message: "Warehouse deleted successfully"
    });
  } catch (error) {
    console.error("Delete warehouse error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to delete warehouse"
    });
  }
});

/**
 * @route   GET /api/warehouses/:id/inventory
 * @desc    Get warehouse inventory
 * @access  Private/Admin
 */
router.get("/:id/inventory", protect, admin, async (req, res) => {
  try {
    const { page, limit, productId, lowStock } = req.query;
    const options = { page, limit, productId, lowStock };
    
    const result = await warehouseService.getWarehouseInventory(req.params.id, options);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Get warehouse inventory error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get inventory"
    });
  }
});

/**
 * @route   PUT /api/warehouses/:id/inventory/:productId
 * @desc    Update warehouse stock for a product
 * @access  Private/Admin
 */
router.put("/:id/inventory/:productId", protect, admin, async (req, res) => {
  try {
    const { quantity, operation } = req.body;
    
    if (quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "Quantity is required"
      });
    }

    const inventory = await warehouseService.updateWarehouseStock(
      req.params.id,
      req.params.productId,
      { quantity, operation }
    );

    res.status(200).json({
      success: true,
      inventory
    });
  } catch (error) {
    console.error("Update warehouse stock error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update stock"
    });
  }
});

/**
 * @route   GET /api/warehouses/:id/low-stock
 * @desc    Get low stock alerts for warehouse
 * @access  Private/Admin
 */
router.get("/:id/low-stock", protect, admin, async (req, res) => {
  try {
    const alerts = await warehouseService.getLowStockAlerts(req.params.id);

    res.status(200).json({
      success: true,
      count: alerts.length,
      alerts
    });
  } catch (error) {
    console.error("Get low stock alerts error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get low stock alerts"
    });
  }
});

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @route   GET /api/warehouses/products/:productId/availability
 * @desc    Check product availability across warehouses
 * @access  Public
 */
router.get("/products/:productId/availability", async (req, res) => {
  try {
    const availability = await warehouseService.getProductAvailability(req.params.productId);

    res.status(200).json({
      success: true,
      ...availability
    });
  } catch (error) {
    console.error("Get product availability error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get product availability"
    });
  }
});

/**
 * @route   POST /api/warehouses/select-for-order
 * @desc    Select optimal warehouse for order
 * @access  Public
 */
router.post("/select-for-order", async (req, res) => {
  try {
    const { orderItems, deliveryAddress } = req.body;

    if (!orderItems || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: "Order items and delivery address are required"
      });
    }

    const result = await warehouseService.selectWarehouseForOrder(orderItems, deliveryAddress);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Select warehouse for order error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to select warehouse"
    });
  }
});

/**
 * @route   GET /api/warehouses/nearest
 * @desc    Find nearest warehouse to coordinates
 * @access  Public
 */
router.get("/nearest", async (req, res) => {
  try {
    const { latitude, longitude, maxDistance } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const warehouse = await warehouseService.findNearestWarehouse(
      parseFloat(latitude),
      parseFloat(longitude),
      maxDistance ? parseInt(maxDistance) : undefined
    );

    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "No warehouse found within range"
      });
    }

    res.status(200).json({
      success: true,
      warehouse
    });
  } catch (error) {
    console.error("Find nearest warehouse error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to find nearest warehouse"
    });
  }
});

export default router;
