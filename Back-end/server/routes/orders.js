import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateOrder, 
  validateIdParam, 
  validateShipmentParams,
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
import { uploadPdfSingle, validatePdfUpload, handleMulterError } from "../middleware/uploadMiddleware.js";
import { checkoutRateLimit } from "../middleware/rateLimitMiddleware.js";
import { validateCancellation } from "../middleware/orderStatusMiddleware.js";
import { checkoutSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";
import {
  getOrders,
  getRefunds,
  getOrderById,
  downloadInvoice,
  createOrder,
  createGuestOrder,
  createOfflineOrder,
  cancelOrder,
  processRefund,
  cancelPayment,
  markPaymentFailed,
  deleteOrder,
  updateOrderStatus,
  getShipments,
  createShipment,
  markShipmentDelivered,
  dispatchShipment,
  markShipmentLost,
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

// @route   GET /orders/:id/invoice
// @desc    Download the invoice PDF (owner or admin)
// @access  Private
router.get("/:id/invoice", protect, validateIdParam, asyncHandler(downloadInvoice));

// @route   POST /orders
// @desc    Create new order from cart
// @access  Private
router.post("/", protect, validateOrder, asyncHandler(createOrder));

// @route   POST /orders/guest
// @desc    Create guest order (no authentication required)
// @access  Public
router.post("/guest", checkoutRateLimit, validateOrder, asyncHandler(createGuestOrder));

// @route   POST /orders/admin/offline
// @desc    Create an offline order for a closed sales deal (Admin only)
// @access  Private/Admin
router.post("/admin/offline", protect, admin, asyncHandler(createOfflineOrder));

// @route   PUT /orders/:id/cancel
// @desc    Cancel an order with validation and refund initiation
// @access  Private
router.put("/:id/cancel", protect, validateOrderCancellation, validateCancellation, asyncHandler(cancelOrder));

// @route   POST /orders/:id/refund
// @desc    Process the Razorpay refund for a cancelled, paid order (admin-triggered)
// @access  Private/Admin
router.post("/:id/refund", protect, admin, validateIdParam, asyncHandler(processRefund));

// @route   PUT /orders/:id/payment-failed
// @desc    Mark order as failed due to payment failure
// @access  Private
router.put("/:id/payment-failed", protect, validatePaymentFailed, asyncHandler(markPaymentFailed));

// @route   PUT /orders/:id/payment-cancelled
// @desc    Customer cancelled the payment (popup dismissed) — payment-axis only
// @access  Private
router.put("/:id/payment-cancelled", protect, validateIdParam, asyncHandler(cancelPayment));

// @route   DELETE /orders/:id
// @desc    Delete an order (Only cancelled or failed orders)
// @access  Private
router.delete("/:id", protect, validateIdParam, asyncHandler(deleteOrder));

// @route   PUT /orders/:id/status
// @desc    Update order status with validation (Admin only)
// @access  Private/Admin
// Accepts an optional `slip` PDF (multipart) when shipping; multer passes plain
// JSON requests through untouched, so non-shipped updates are unaffected.
router.put(
  "/:id/status",
  protect,
  admin,
  uploadPdfSingle('slip'),
  handleMulterError,
  validatePdfUpload,
  validateOrderStatusUpdate,
  asyncHandler(updateOrderStatus)
);

// ── Split shipments ─────────────────────────────────────────────────────────
// An order can leave in several parcels, each with its own courier, AWB and
// delivery date. The order's `status` stays derived from these (see
// utils/orderFulfilment.js); these routes write the parcels themselves.

// @route   GET /orders/:id/shipments
// @desc    Parcels on an order + what is still to ship + the fulfilment label
// @access  Private (order owner or admin)
router.get("/:id/shipments", protect, validateIdParam, asyncHandler(getShipments));

// @route   POST /orders/:id/shipments
// @desc    Create one parcel from a subset of the outstanding lines (Admin only)
// @access  Private/Admin
router.post("/:id/shipments", protect, admin, validateIdParam, asyncHandler(createShipment));

// @route   PATCH /orders/:id/shipments/:shipmentId/dispatch
// @desc    Hand an already-packed parcel to the courier (Admin only). Idempotent.
// @access  Private/Admin
// Without this a `packed` parcel is a dead end: its units are consumed from the
// remaining-to-ship pool, so they can never go in another box, and nothing moves it on.
router.patch(
  "/:id/shipments/:shipmentId/dispatch",
  protect,
  admin,
  validateShipmentParams,
  asyncHandler(dispatchShipment)
);

// @route   PATCH /orders/:id/shipments/:shipmentId/delivered
// @desc    Mark one parcel delivered (Admin only). Idempotent.
// @access  Private/Admin
router.patch(
  "/:id/shipments/:shipmentId/delivered",
  protect,
  admin,
  validateShipmentParams,
  asyncHandler(markShipmentDelivered)
);

// @route   PATCH /orders/:id/shipments/:shipmentId/lost
// @desc    Write off a parcel the courier lost (Admin only). Its units return to the
//          remaining-to-ship pool so a replacement can be sent.
// @access  Private/Admin
router.patch(
  "/:id/shipments/:shipmentId/lost",
  protect,
  admin,
  validateShipmentParams,
  asyncHandler(markShipmentLost)
);

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
