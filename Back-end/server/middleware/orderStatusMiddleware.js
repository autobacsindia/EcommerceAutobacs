/**
 * Order Status Validation Middleware
 * Validates order status transitions before processing
 */

import orderStatusService from '../services/orderStatusService.js';
import Order from '../models/Order.js';

/**
 * Validate status transition request
 * Checks if the requested status transition is valid
 */
export const validateStatusTransition = async (req, res, next) => {
  try {
    const { status } = req.body;
    const { id: orderId } = req.params;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if transition is valid
    const isAdmin = req.user && req.user.role === 'admin';
    const validation = orderStatusService.validateTransition(
      order.status,
      status,
      isAdmin
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    // Attach order to request for use in route handler
    req.order = order;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating status transition',
      error: error.message
    });
  }
};

/**
 * Validate that user can cancel order
 * Customers can only cancel orders in specific states
 */
export const validateCancellation = async (req, res, next) => {
  try {
    const { id: orderId } = req.params;

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Ensure user owns the order (unless admin)
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin && order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Check if customer can cancel
    if (!isAdmin) {
      const canCancel = orderStatusService.canCustomerCancel(order);
      if (!canCancel.canCancel) {
        return res.status(400).json({
          success: false,
          message: canCancel.reason
        });
      }
    }

    // Attach order to request
    req.order = order;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating cancellation',
      error: error.message
    });
  }
};

/**
 * Validate reason for status change
 * Ensures provided reason is valid for the target status
 */
export const validateStatusReason = async (req, res, next) => {
  try {
    const { status, reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for status change'
      });
    }

    const validReasons = orderStatusService.getValidReasons(status);
    
    if (validReasons.length > 0 && !validReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: `Invalid reason '${reason}' for status '${status}'. Valid reasons: ${validReasons.join(', ')}`
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating status reason',
      error: error.message
    });
  }
};

/**
 * Check if order can be refunded
 * Only delivered orders can be refunded
 */
export const validateRefundEligibility = async (req, res, next) => {
  try {
    const { id: orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Only delivered orders can be refunded
    if (order.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Only delivered orders can be refunded'
      });
    }

    // Check if order is not too old (e.g., 30 days return window)
    const deliveredDate = new Date(order.deliveredAt);
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate) / (1000 * 60 * 60 * 24));
    const returnWindow = 30; // days

    if (daysSinceDelivery > returnWindow) {
      return res.status(400).json({
        success: false,
        message: `Return window expired. Orders can only be returned within ${returnWindow} days of delivery`
      });
    }

    req.order = order;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating refund eligibility',
      error: error.message
    });
  }
};

/**
 * Validate tracking information
 * Ensures tracking data is properly formatted
 */
export const validateTrackingInfo = (req, res, next) => {
  try {
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({
        success: false,
        message: 'Tracking number is required'
      });
    }

    // Basic tracking number format validation
    if (trackingNumber.length < 8 || trackingNumber.length > 40) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking number format'
      });
    }

    if (carrier && carrier.name) {
      const validCarriers = [
        'FedEx', 'UPS', 'DHL', 'USPS', 'India Post', 
        'Delhivery', 'Blue Dart', 'DTDC', 'Ecom Express'
      ];
      
      if (!validCarriers.includes(carrier.name)) {
        return res.status(400).json({
          success: false,
          message: `Invalid carrier. Valid carriers: ${validCarriers.join(', ')}`
        });
      }
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating tracking information',
      error: error.message
    });
  }
};

export default {
  validateStatusTransition,
  validateCancellation,
  validateStatusReason,
  validateRefundEligibility,
  validateTrackingInfo
};
