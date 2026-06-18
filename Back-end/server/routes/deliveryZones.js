import express from "express";
import deliveryZoneService from "../services/deliveryZoneService.js";
import cacheService from "../services/cacheService.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  validatePinCodeParam,
  validateDeliveryEstimate,
  validateShippingCost
} from "../middleware/validationMiddleware.js";

const router = express.Router();

// ============================================
// PUBLIC ROUTES
// ============================================

/**
 * @route   GET /api/delivery-zones/pincode/:pinCode
 * @desc    Get delivery zone by PIN code
 * @access  Public
 */
router.get("/pincode/:pinCode", validatePinCodeParam, async (req, res) => {
  try {
    const zone = await deliveryZoneService.getZoneByPinCode(req.params.pinCode);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: `No delivery zone found for PIN code: ${req.params.pinCode}`
      });
    }

    res.status(200).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Get zone by PIN code error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get delivery zone"
    });
  }
});

/**
 * @route   POST /api/delivery-zones/check-serviceability
 * @desc    Check if PIN code is serviceable
 * @access  Public
 */
router.post("/check-serviceability", async (req, res) => {
  try {
    const { pinCode } = req.body;

    if (!pinCode) {
      return res.status(400).json({
        success: false,
        message: "PIN code is required"
      });
    }

    const result = await deliveryZoneService.checkServiceability(pinCode);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Check serviceability error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to check serviceability"
    });
  }
});

/**
 * @route   POST /api/delivery-zones/estimate
 * @desc    Get delivery estimate for PIN code
 * @access  Public
 */
router.post("/estimate", validateDeliveryEstimate, async (req, res) => {
  try {
    const { pinCode, orderDate } = req.body;

    const result = await deliveryZoneService.getDeliveryEstimate(
      pinCode,
      orderDate ? new Date(orderDate) : undefined
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Get delivery estimate error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to get delivery estimate"
    });
  }
});

/**
 * @route   POST /api/delivery-zones/shipping-cost
 * @desc    Calculate shipping cost for PIN code and weight
 * @access  Public
 */
router.post("/shipping-cost", validateShippingCost, async (req, res) => {
  try {
    const { pinCode, weightKg } = req.body;

    const result = await deliveryZoneService.calculateShippingCost(
      pinCode,
      weightKg || 0
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Calculate shipping cost error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to calculate shipping cost"
    });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

/**
 * @route   GET /api/delivery-zones
 * @desc    Get all delivery zones
 * @access  Private/Admin
 */
const DELIVERY_ZONES_TTL = 5 * 60; // 5 min — zone config changes rarely

router.get("/", protect, admin, async (req, res) => {
  try {
    const { type, serviceable } = req.query;
    const filters = {
      type,
      serviceable: serviceable ? serviceable === 'true' : undefined
    };

    const cacheKey = `delivery-zones:list:${type || 'all'}:${serviceable ?? 'all'}`;
    const cached = await cacheService.get(cacheKey).catch(() => null);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const zones = await deliveryZoneService.getAllZones(filters);
    const body = { success: true, count: zones.length, zones };

    cacheService.set(cacheKey, body, DELIVERY_ZONES_TTL * 1000).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(body);
  } catch (error) {
    console.error("Get zones error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get delivery zones"
    });
  }
});

/**
 * @route   POST /api/delivery-zones
 * @desc    Create new delivery zone
 * @access  Private/Admin
 */
router.post("/", protect, admin, async (req, res) => {
  try {
    const zone = await deliveryZoneService.createZone(req.body);

    cacheService.invalidatePattern('delivery-zones:list').catch(() => {});

    res.status(201).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Create zone error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to create delivery zone"
    });
  }
});

/**
 * @route   GET /api/delivery-zones/:id
 * @desc    Get delivery zone by ID
 * @access  Private/Admin
 */
router.get("/:id", protect, admin, async (req, res) => {
  try {
    const zone = await deliveryZoneService.getZoneById(req.params.id);

    res.status(200).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Get zone error:", error);
    res.status(404).json({
      success: false,
      message: error.message || "Delivery zone not found"
    });
  }
});

/**
 * @route   PUT /api/delivery-zones/:id
 * @desc    Update delivery zone
 * @access  Private/Admin
 */
router.put("/:id", protect, admin, async (req, res) => {
  try {
    const zone = await deliveryZoneService.updateZone(req.params.id, req.body);

    cacheService.invalidatePattern('delivery-zones:list').catch(() => {});

    res.status(200).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Update zone error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update delivery zone"
    });
  }
});

/**
 * @route   DELETE /api/delivery-zones/:id
 * @desc    Delete delivery zone
 * @access  Private/Admin
 */
router.delete("/:id", protect, admin, async (req, res) => {
  try {
    await deliveryZoneService.deleteZone(req.params.id);

    cacheService.invalidatePattern('delivery-zones:list').catch(() => {});

    res.status(200).json({
      success: true,
      message: "Delivery zone deleted successfully"
    });
  } catch (error) {
    console.error("Delete zone error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to delete delivery zone"
    });
  }
});

/**
 * @route   POST /api/delivery-zones/:id/pincodes
 * @desc    Add PIN codes to zone
 * @access  Private/Admin
 */
router.post("/:id/pincodes", protect, admin, async (req, res) => {
  try {
    const { pinCodes } = req.body;

    if (!pinCodes || !Array.isArray(pinCodes)) {
      return res.status(400).json({
        success: false,
        message: "PIN codes array is required"
      });
    }

    const zone = await deliveryZoneService.addPinCodes(req.params.id, pinCodes);

    res.status(200).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Add PIN codes error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to add PIN codes"
    });
  }
});

/**
 * @route   DELETE /api/delivery-zones/:id/pincodes
 * @desc    Remove PIN codes from zone
 * @access  Private/Admin
 */
router.delete("/:id/pincodes", protect, admin, async (req, res) => {
  try {
    const { pinCodes } = req.body;

    if (!pinCodes || !Array.isArray(pinCodes)) {
      return res.status(400).json({
        success: false,
        message: "PIN codes array is required"
      });
    }

    const zone = await deliveryZoneService.removePinCodes(req.params.id, pinCodes);

    res.status(200).json({
      success: true,
      zone
    });
  } catch (error) {
    console.error("Remove PIN codes error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to remove PIN codes"
    });
  }
});

/**
 * @route   POST /api/delivery-zones/bulk-import
 * @desc    Bulk import PIN codes
 * @access  Private/Admin
 */
router.post("/bulk-import", protect, admin, async (req, res) => {
  try {
    const { pinCodeData } = req.body;

    if (!pinCodeData || !Array.isArray(pinCodeData)) {
      return res.status(400).json({
        success: false,
        message: "PIN code data array is required"
      });
    }

    const result = await deliveryZoneService.bulkImportPinCodes(pinCodeData);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to import PIN codes"
    });
  }
});

/**
 * @route   GET /api/delivery-zones/summary
 * @desc    Get zones summary statistics
 * @access  Private/Admin
 */
router.get("/admin/summary", protect, admin, async (req, res) => {
  try {
    const summary = await deliveryZoneService.getZonesSummary();

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    console.error("Get zones summary error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get zones summary"
    });
  }
});

export default router;
