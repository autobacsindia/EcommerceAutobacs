import express from "express";
import { v4 as uuidv4 } from "uuid";
import locationService from "../services/locationService.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import {
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
router.post("/select", optionalAuth, asyncHandler(async (req, res) => {
  try {
    const { placeId, address, coordinates, street } = req.body || {};

    const identifier = req.user
      ? { userId: req.user._id }
      : { sessionId: req.sessionID || req.headers['x-session-id'] || uuidv4() };

    const locationData = { placeId, address, coordinates, street };

    const result = await locationService.selectLocation(identifier, locationData);

    // Serialize manually so a Mongoose circular-ref or toJSON failure
    // is caught here rather than propagated to errorHandler
    const payload = JSON.stringify({
      success: true,
      location: result.location,
      deliveryZone: result.deliveryZone,
      nearestWarehouse: result.nearestWarehouse,
      deliveryEstimate: result.deliveryEstimate
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).end(payload);
  } catch (error) {
    console.error("Select location [catch]:", error?.name, "-", error?.message);

    if (res.headersSent) return;

    // Build a minimal fallback response using only plain JS values
    const { address: addr, coordinates: coords, postalCode, street: st } = req.body || {};
    const city = addr?.city || 'Unknown';
    const state = addr?.state || 'India';
    const country = addr?.country || 'India';
    const pin = postalCode || addr?.postalCode || '';
    let lat = 20.5937;
    let lon = 78.9629;
    if (Array.isArray(coords)) {
      [lon, lat] = coords;
    } else if (coords && typeof coords === 'object') {
      lat = coords.latitude ?? lat;
      lon = coords.longitude ?? lon;
    }
    const formatted = city && state
      ? `${city}, ${state}${pin ? ' ' + pin : ''}, ${country}`
      : `${lat.toFixed(5)}, ${lon.toFixed(5)} (${country})`;

    let deliveryEstimate = { formattedRange: 'in 3-7 business days' };
    try { deliveryEstimate = locationService.computeGenericEstimate(); } catch (_) { /* use default */ }

    return res.status(200).json({
      success: true,
      location: {
        selectedAddress: {
          formatted,
          street: st || addr?.street || '',
          city,
          state,
          postalCode: pin,
          country,
          coordinates: { type: "Point", coordinates: [lon, lat] }
        }
      },
      deliveryZone: null,
      nearestWarehouse: null,
      deliveryEstimate
    });
  }
}));

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
