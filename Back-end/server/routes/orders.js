import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateOrder, 
  validateIdParam, 
  validateOrderStatusUpdate, 
  validateOrderCancellation, 
  validateBulkStatusUpdate, 
  validateBulkDelete,
  validateTrackingInfo,
  validateTrackingEvent,
  validatePaymentFailed,
  validatePagination,
  validateOrderAnalyticsQuery,
  validateOrderReturn,
  validateReturnStatusUpdate,
  validateRefundsQuery,
  validateAdminOrderQuery
} from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkoutRateLimit } from "../middleware/rateLimitMiddleware.js";
import { validateCancellation } from "../middleware/orderStatusMiddleware.js";
import { checkoutSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";
import {
  getOrders,
  getRefunds,
  getOrderById,
  createOrder,
  createGuestOrder,
  cancelOrder,
  markPaymentFailed,
  deleteOrder,
  updateOrderStatus,
  bulkUpdateStatus,
  bulkDeleteOrders,
  getStatusHistory,
  getValidTransitions,
  getStatusStats,
  getFulfillmentMetrics,
  addTracking,
  getTracking,
  addTrackingEvent,
  trackByNumber,
  getCarriers,
  simulateTracking,
  getTrackingStats,
  getAllOrdersAdmin,
  submitReturnRequest,
  getReturnRequest,
  updateReturnStatus
} from "../controllers/orderController.js";

const router = express.Router();

// Apply session keep-alive middleware to checkout routes (order creation)
router.use(checkoutSessionKeepAlive);
router.use(attachTokenRefreshInfo);

// @route   GET /orders
// @desc    Get all orders for logged-in user with pagination
// @access  Private
router.get("/", protect, validatePagination, asyncHandler(getOrders));

// @route   GET /orders/refunds
// @desc    Get all refunds (orders with refundDetails)
// @access  Private/Admin
router.get("/refunds", protect, admin, validateRefundsQuery, asyncHandler(getRefunds));

// @route   GET /orders/:id
// @desc    Get order by ID
// @access  Private
router.get("/:id", protect, validateIdParam, asyncHandler(getOrderById));

// @route   POST /orders
// @desc    Create new order from cart
// @access  Private
router.post("/", protect, validateOrder, asyncHandler(createOrder));

// @route   POST /orders/guest
// @desc    Create guest order (no authentication required)
// @access  Public
router.post("/guest", checkoutRateLimit, validateOrder, asyncHandler(createGuestOrder));

// @route   PUT /orders/:id/cancel
// @desc    Cancel an order with validation and refund initiation
// @access  Private
router.put("/:id/cancel", protect, validateOrderCancellation, validateCancellation, asyncHandler(cancelOrder));

// @route   PUT /orders/:id/payment-failed
// @desc    Mark order as failed due to payment failure
// @access  Private
router.put("/:id/payment-failed", protect, validatePaymentFailed, asyncHandler(markPaymentFailed));

// @route   DELETE /orders/:id
// @desc    Delete an order (Only cancelled or failed orders)
// @access  Private
router.delete("/:id", protect, validateIdParam, asyncHandler(deleteOrder));

// @route   PUT /orders/:id/status
// @desc    Update order status with validation (Admin only)
// @access  Private/Admin
router.put("/:id/status", protect, admin, validateOrderStatusUpdate, asyncHandler(updateOrderStatus));

// @route   POST /orders/bulk/status
// @desc    Bulk update order status (Admin only)
// @access  Private/Admin
router.post("/bulk/status", protect, admin, validateBulkStatusUpdate, asyncHandler(bulkUpdateStatus));

// @route   POST /orders/bulk/delete
// @desc    Bulk delete orders (Admin only, restricted to cancelled/failed)
// @access  Private/Admin
router.post("/bulk/delete", protect, admin, validateBulkDelete, asyncHandler(bulkDeleteOrders));

// @route   GET /orders/:id/status-history
// @desc    Get status history for an order
// @access  Private
router.get("/:id/status-history", protect, validateIdParam, asyncHandler(getStatusHistory));

// @route   GET /orders/:id/valid-transitions
// @desc    Get valid next statuses for an order
// @access  Private
router.get("/:id/valid-transitions", protect, validateIdParam, asyncHandler(getValidTransitions));

// @route   GET /orders/analytics/status-stats
// @desc    Get order status statistics (Admin only)
// @access  Private/Admin
router.get("/analytics/status-stats", protect, admin, validateOrderAnalyticsQuery, asyncHandler(getStatusStats));

// @route   GET /orders/analytics/fulfillment-metrics
// @desc    Get fulfillment performance metrics (Admin only)
// @access  Private/Admin
router.get("/analytics/fulfillment-metrics", protect, admin, validateOrderAnalyticsQuery, asyncHandler(getFulfillmentMetrics));

// ========================================
// TRACKING ENDPOINTS
// ========================================

// @route   POST /orders/:id/tracking
// @desc    Add tracking information to order (Admin only)
// @access  Private/Admin
router.post("/:id/tracking", protect, admin, validateTrackingInfo, asyncHandler(addTracking));

// @route   GET /orders/:id/tracking
// @desc    Get tracking history for an order
// @access  Private
router.get("/:id/tracking", protect, validateIdParam, asyncHandler(getTracking));

// @route   POST /orders/:id/tracking/events
// @desc    Add tracking event to order (Admin only)
// @access  Private/Admin
router.post("/:id/tracking/events", protect, admin, validateTrackingEvent, asyncHandler(addTrackingEvent));

// @route   GET /orders/track/:trackingNumber
// @desc    Public tracking lookup by tracking number
// @access  Public
router.get("/track/:trackingNumber", asyncHandler(trackByNumber));

// @route   GET /orders/tracking/carriers
// @desc    Get list of supported carriers
// @access  Public
router.get("/tracking/carriers", asyncHandler(getCarriers));

// @route   POST /orders/:id/tracking/simulate
// @desc    Simulate tracking events for testing (Admin only)
// @access  Private/Admin
router.post("/:id/tracking/simulate", protect, admin, asyncHandler(simulateTracking));

// @route   GET /orders/analytics/tracking-stats
// @desc    Get tracking statistics by carrier (Admin only)
// @access  Private/Admin
router.get("/analytics/tracking-stats", protect, admin, validateOrderAnalyticsQuery, asyncHandler(getTrackingStats));

// @route   GET /orders/admin/all
// @desc    Get all orders (Admin only)
// @access  Private/Admin
router.get("/admin/all", protect, admin, validateAdminOrderQuery, asyncHandler(getAllOrdersAdmin));

// ========================================
// RETURN REQUEST ENDPOINTS
// ========================================

// @route   POST /orders/:id/return
// @desc    Submit return request for delivered order
// @access  Private
router.post("/:id/return", protect, validateIdParam, validateOrderReturn, asyncHandler(submitReturnRequest));

// @route   GET /orders/:id/return
// @desc    Get return request details
// @access  Private
router.get("/:id/return", protect, validateIdParam, asyncHandler(getReturnRequest));

// @route   PUT /orders/:id/return/status
// @desc    Update return request status (Admin only)
// @access  Private/Admin
router.put("/:id/return/status", protect, admin, validateReturnStatusUpdate, asyncHandler(updateReturnStatus));

export default router;
