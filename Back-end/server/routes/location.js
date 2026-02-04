import express from "express";
import locationService from "../services/locationService.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { 
  validateLocationSelect, 
  validatePostalCode, 
  validatePostalCodeQuery,
  validateRecentLocations
} from "../middleware/validationMiddleware.js";

const router = express.Router();

/**
 * @route   POST /api/location/select
 * @desc    Select and save user location
 * @access  Public
 */
router.post("/select", optionalAuth, validateLocationSelect, async (req, res) => {
  try {
    // DEBUG: Log the incoming request
    console.log('\n=== Location Route Debug ===');
    console.log('req.body:', JSON.stringify(req.body, null, 2));
    console.log('req.user:', req.user ? `Authenticated: ${req.user._id}` : 'Guest');
    console.log('req.headers[x-session-id]:', req.headers['x-session-id']);
    console.log('============================\n');

    const { placeId, address, coordinates, street } = req.body;
    
    // Get identifier (userId if authenticated, sessionId if guest)
    const identifier = req.user 
      ? { userId: req.user._id }
      : { sessionId: req.sessionID || req.headers['x-session-id'] };

    if (!identifier.userId && !identifier.sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID required for guest users"
      });
    }

    const locationData = { placeId, address, coordinates, street };
    
    const result = await locationService.selectLocation(identifier, locationData);

    res.status(200).json({
      success: true,
      location: result.location,
      deliveryZone: result.deliveryZone,
      nearestWarehouse: result.nearestWarehouse,
      deliveryEstimate: result.deliveryEstimate
    });
  } catch (error) {
    console.error("Select location error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to select location"
    });
  }
});

/**
 * @route   GET /api/location/current
 * @desc    Get current user location
 * @access  Public
 */
router.get("/current", optionalAuth, async (req, res) => {
  try {
    const identifier = req.user 
      ? { userId: req.user._id }
      : { sessionId: req.sessionID || req.headers['x-session-id'] };

    const result = await locationService.getCurrentLocation(identifier);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "No location set"
      });
    }

    res.status(200).json({
      success: true,
      location: result.location,
      deliveryZone: result.deliveryZone,
      nearestWarehouse: result.nearestWarehouse,
      deliveryEstimate: result.deliveryEstimate
    });
  } catch (error) {
    console.error("Get current location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get location"
    });
  }
});

/**
 * @route   POST /api/location/validate
 * @desc    Validate if address is serviceable
 * @access  Public
 */
router.post("/validate", validatePostalCode, async (req, res) => {
  try {
    const { postalCode } = req.body;

    const result = await locationService.validateAddress(postalCode);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Validate address error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to validate address"
    });
  }
});

/**
 * @route   GET /api/location/recent
 * @desc    Get recent locations for authenticated user
 * @access  Private
 */
router.get("/recent", protect, validateRecentLocations, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const locations = await locationService.getRecentLocations(req.user._id, limit);

    res.status(200).json({
      success: true,
      locations
    });
  } catch (error) {
    console.error("Get recent locations error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get recent locations"
    });
  }
});

/**
 * @route   DELETE /api/location/clear
 * @desc    Clear saved location
 * @access  Public
 */
router.delete("/clear", optionalAuth, async (req, res) => {
  try {
    const identifier = req.user 
      ? { userId: req.user._id }
      : { sessionId: req.sessionID || req.headers['x-session-id'] };

    await locationService.clearLocation(identifier);

    res.status(200).json({
      success: true,
      message: "Location cleared successfully"
    });
  } catch (error) {
    console.error("Clear location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to clear location"
    });
  }
});

/**
 * @route   GET /api/location/estimate
 * @desc    Get delivery estimate for a postal code
 * @access  Public
 */
router.get("/estimate", validatePostalCodeQuery, async (req, res) => {
  try {
    const { postalCode } = req.query;

    const result = await locationService.getDeliveryEstimate(postalCode);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("Get delivery estimate error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get delivery estimate"
    });
  }
});

export default router;
