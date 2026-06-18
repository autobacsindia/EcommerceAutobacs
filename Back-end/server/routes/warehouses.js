import express from "express";
import warehouseService from "../services/warehouseService.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  validateWarehouse,
  validateWarehouseUpdate,
  validateIdParam,
  validateWarehouseInventoryQuery,
  validateWarehouseStockUpdate,
  validateProductIdParam,
  validateWarehouseSelection,
  validateLocationCoordinates,
  validateWarehouseQuery
} from "../middleware/validationMiddleware.js";

const router = express.Router();

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @route   GET /api/warehouses
 * @desc    Get all warehouses
 * @access  Private/Admin
 */
router.get("/", protect, admin, validateWarehouseQuery, async (req, res) => {
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
router.post("/", protect, admin, validateWarehouse, async (req, res) => {
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
 * @route   GET /api/warehouses/public
 * @desc    Return active warehouses for the public storefront (homepage network section)
 * @access  Public — returns only display-safe fields, no internal metrics
 */
router.get("/public", async (req, res) => {
  try {
    const warehouses = await warehouseService.getAllWarehouses({ status: 'active', showOnHomepage: true });

    const publicData = warehouses.map(w => ({
      id:                  w._id,
      name:                w.name,
      type:                w.type,
      city:                w.location?.city,
      state:               w.location?.state,
      serviceablePinCount: w.serviceablePinCodes?.length ?? 0,
      operationalStatus:   w.operationalStatus,
    }));

    res.json({ success: true, warehouses: publicData });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load locations' });
  }
});

/**
 * @route   GET /api/warehouses/:id
 * @desc    Get warehouse by ID
 * @access  Private/Admin
 */
router.get("/:id", protect, admin, validateIdParam, async (req, res) => {
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
router.put("/:id", protect, admin, validateWarehouseUpdate, async (req, res) => {
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
router.delete("/:id", protect, admin, validateIdParam, async (req, res) => {
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
router.get("/:id/inventory", protect, admin, validateWarehouseInventoryQuery, async (req, res) => {
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
router.put("/:id/inventory/:productId", protect, admin, validateWarehouseStockUpdate, async (req, res) => {
  try {
    const { quantity, operation } = req.body;
    
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
router.get("/:id/low-stock", protect, admin, validateIdParam, async (req, res) => {
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
router.get("/products/:productId/availability", validateProductIdParam, async (req, res) => {
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
router.post("/select-for-order", validateWarehouseSelection, async (req, res) => {
  try {
    const { orderItems, deliveryAddress } = req.body;

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
router.get("/nearest", validateLocationCoordinates, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance } = req.query;

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
