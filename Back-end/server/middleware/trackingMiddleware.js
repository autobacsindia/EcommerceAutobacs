/**
 * Tracking Middleware
 * Validates tracking-related requests
 */

import orderTrackingService, { CARRIERS, TRACKING_STATUS } from '../services/orderTrackingService.js';
import Order from '../models/Order.js';

/**
 * Validate carrier code
 */
export const validateCarrier = (req, res, next) => {
  const { carrierCode } = req.body;

  if (!carrierCode) {
    return res.status(400).json({
      success: false,
      message: 'Carrier code is required'
    });
  }

  const carrier = orderTrackingService.getCarrier(carrierCode);
  if (!carrier) {
    const validCodes = Object.keys(CARRIERS).join(', ');
    return res.status(400).json({
      success: false,
      message: `Invalid carrier code '${carrierCode}'. Valid carriers: ${validCodes}`
    });
  }

  // Attach carrier to request
  req.carrier = carrier;
  next();
};

/**
 * Validate tracking number format
 */
export const validateTrackingNumberFormat = (req, res, next) => {
  const { trackingNumber, carrierCode } = req.body;

  if (!trackingNumber) {
    // Optional - can be auto-generated
    return next();
  }

  if (!carrierCode) {
    return res.status(400).json({
      success: false,
      message: 'Carrier code is required when providing tracking number'
    });
  }

  const isValid = orderTrackingService.validateTrackingNumber(trackingNumber, carrierCode);
  if (!isValid) {
    const carrier = orderTrackingService.getCarrier(carrierCode);
    return res.status(400).json({
      success: false,
      message: `Invalid tracking number format for carrier ${carrier?.name}. Expected format: ${carrier?.trackingNumberFormat}`
    });
  }

  next();
};

/**
 * Validate tracking event status
 */
export const validateTrackingStatus = (req, res, next) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  const validStatuses = Object.values(TRACKING_STATUS);
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid tracking status '${status}'. Valid statuses: ${validStatuses.join(', ')}`
    });
  }

  next();
};

/**
 * Check if order has tracking
 */
export const ensureOrderHasTracking = async (req, res, next) => {
  try {
    const { id: orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (!order.trackingNumber) {
      return res.status(400).json({
        success: false,
        message: 'Order does not have tracking information. Please add tracking first.'
      });
    }

    // Attach order to request
    req.order = order;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking order tracking',
      error: error.message
    });
  }
};

/**
 * Validate event location
 */
export const validateLocation = (req, res, next) => {
  const { location } = req.body;

  if (location && location.length > 200) {
    return res.status(400).json({
      success: false,
      message: 'Location description too long (max 200 characters)'
    });
  }

  next();
};

/**
 * Validate simulation scenario
 */
export const validateSimulationScenario = (req, res, next) => {
  const { scenario } = req.body;

  const validScenarios = ['normal_delivery', 'delayed', 'failed_delivery'];
  
  if (scenario && !validScenarios.includes(scenario)) {
    return res.status(400).json({
      success: false,
      message: `Invalid scenario '${scenario}'. Valid scenarios: ${validScenarios.join(', ')}`
    });
  }

  next();
};

/**
 * Rate limit tracking lookups (prevent abuse)
 */
const trackingLookupCache = new Map();
const LOOKUP_LIMIT = 10; // Max lookups per tracking number per hour
const LOOKUP_WINDOW = 60 * 60 * 1000; // 1 hour

export const rateLimitTrackingLookup = (req, res, next) => {
  const { trackingNumber } = req.params;
  const now = Date.now();

  // Clean old entries
  for (const [key, data] of trackingLookupCache.entries()) {
    if (now - data.firstLookup > LOOKUP_WINDOW) {
      trackingLookupCache.delete(key);
    }
  }

  // Check rate limit
  const lookupData = trackingLookupCache.get(trackingNumber);
  
  if (!lookupData) {
    trackingLookupCache.set(trackingNumber, {
      count: 1,
      firstLookup: now
    });
    return next();
  }

  if (lookupData.count >= LOOKUP_LIMIT) {
    return res.status(429).json({
      success: false,
      message: 'Too many tracking lookups for this number. Please try again later.'
    });
  }

  lookupData.count++;
  next();
};

/**
 * Validate timestamp format
 */
export const validateTimestamp = (req, res, next) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    // Optional - will use current time
    return next();
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid timestamp format. Use ISO 8601 format (e.g., 2024-12-02T10:00:00Z)'
    });
  }

  // Check if timestamp is not in the future
  if (date > new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Timestamp cannot be in the future'
    });
  }

  // Check if timestamp is not too old (e.g., more than 1 year ago)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  if (date < oneYearAgo) {
    return res.status(400).json({
      success: false,
      message: 'Timestamp cannot be more than 1 year old'
    });
  }

  next();
};

export default {
  validateCarrier,
  validateTrackingNumberFormat,
  validateTrackingStatus,
  ensureOrderHasTracking,
  validateLocation,
  validateSimulationScenario,
  rateLimitTrackingLookup,
  validateTimestamp
};
