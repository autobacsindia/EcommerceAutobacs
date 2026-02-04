import express from "express";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
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
  validateAnalyticsQuery,
  validateReturnRequest,
  validateReturnStatusUpdate,
  validateTrackingNumberParam,
  validateRefundsQuery,
  validateAdminOrderQuery,
  validateTrackingSimulate
} from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import orderStatusService from "../services/orderStatusService.js";
import orderTrackingService from "../services/orderTrackingService.js";
import { validateCancellation } from "../middleware/orderStatusMiddleware.js";
import { checkoutSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";

const router = express.Router();

// Apply session keep-alive middleware to checkout routes (order creation)
router.use(checkoutSessionKeepAlive);
router.use(attachTokenRefreshInfo);

// @route   GET /orders
// @desc    Get all orders for logged-in user with pagination
// @access  Private
router.get("/", protect, validatePagination, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const orders = await Order.find({ user: req.user.id })
    .populate('items.product', 'name images')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const total = await Order.countDocuments({ user: req.user.id });
  
  res.json({
    success: true,
    count: orders.length,
    orders,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalOrders: total,
      hasNext: Number(page) < Math.ceil(total / Number(limit)),
      hasPrev: Number(page) > 1
    }
  });
}));

// @route   GET /orders/refunds
// @desc    Get all refunds (orders with refundDetails)
// @access  Private/Admin
router.get("/refunds", protect, admin, validateRefundsQuery, asyncHandler(async (req, res) => {
  const { status } = req.query;
  
  const query = { 
    'refundDetails': { $exists: true, $ne: null } 
  };
  
  if (status && status !== 'all') {
    query['refundDetails.status'] = status;
  }
  
  const orders = await Order.find(query)
    .populate('user', 'name email')
    .sort({ 'refundDetails.requestedAt': -1 });
    
  const refunds = orders.map(order => ({
    _id: order._id,
    order: {
      _id: order._id,
      orderNumber: order.orderNumber || order._id
    },
    user: {
       name: order.user ? order.user.name : 'Unknown'
     },
     amount: order.refundDetails.amount || 0,
     refundType: order.refundDetails.refundType || '',
     refundMethod: order.refundDetails.refundMethod || '',
      status: order.refundDetails.status || 'pending',
      requestedAt: order.refundDetails.requestedAt || order.updatedAt
    }));
  
  res.json({
    success: true,
    count: refunds.length,
    refunds
  });
}));

// @route   GET /orders/:id
// @desc    Get order by ID
// @access  Private
router.get("/:id", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'name images price')
    .populate('user', 'name email')
    .populate('payment')
    .lean();

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user can only access their own orders (unless admin)
  if (order.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }

  res.json({
    success: true,
    order
  });
}));

// @route   POST /orders
// @desc    Create new order from cart
// @access  Private
router.post("/", protect, validateOrder, asyncHandler(async (req, res) => {
  const { items, shippingAddress, shippingCost = 0, tax = 0, discount = 0 } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No order items provided'
    });
  }

  // Validate all products and calculate totals
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);
    
    if (!product || !product.isActive) {
      return res.status(400).json({
        success: false,
        message: `Product ${item.product} not found or not available`
      });
    }

    if (product.stock < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${product.name}. Only ${product.stock} available`
      });
    }

    orderItems.push({
      product: product._id,
      quantity: item.quantity,
      price: product.price,
      name: product.name,
      image: product.images[0]?.url
    });

    subtotal += product.price * item.quantity;
  }

  const totalAmount = subtotal + Number(shippingCost) + Number(tax) - Number(discount);

  // Create order
  const order = await Order.create({
    user: req.user.id,
    items: orderItems,
    shippingAddress,
    subtotal,
    shippingCost: Number(shippingCost),
    tax: Number(tax),
    discount: Number(discount),
    totalAmount,
    status: 'pending'
  });

  // Update product stock
  for (const item of orderItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity }
    });
  }

  // Clear user's cart after successful order
  await Cart.findOneAndUpdate(
    { user: req.user.id },
    { items: [] }
  );

  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    order
  });
}));

// @route   PUT /orders/:id/cancel
// @desc    Cancel an order with validation and refund initiation
// @access  Private
router.put("/:id/cancel", protect, validateOrderCancellation, validateCancellation, asyncHandler(async (req, res) => {
  const order = req.order; // Attached by validateCancellation middleware
  const { reason, notes } = req.body;

  // Check if order has payment that needs refund
  const needsRefund = order.payment && ['confirmed', 'processing'].includes(order.status);
  
  // Use status service to update to cancelled
  const result = await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
    userId: req.user.id,
    isAdmin: req.user.role === 'admin',
    reason: reason || 'customer_request',
    notes
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  // Restore product stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity }
    });
  }
  
  // Initiate refund if payment was made
  let refundInitiated = false;
  if (needsRefund) {
    const refundAmount = order.totalAmount;
    
    result.order.refundDetails = {
      requestedAt: new Date(),
      amount: refundAmount,
      refundType: 'full',
      refundMethod: 'original_payment',
      itemsRefunded: order.items.map(item => ({
        product: item.product,
        quantity: item.quantity,
        amount: item.price * item.quantity
      })),
      status: 'pending',
      notes: `Automatic refund for cancelled order. Reason: ${reason || 'customer_request'}`
    };
    
    result.order.cancelledAt = new Date();
    result.order.cancellationReason = reason || 'customer_request';
    
    await result.order.save();
    refundInitiated = true;
  }

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order: result.order,
    refundInitiated,
    refundAmount: needsRefund ? order.totalAmount : 0,
    refundTimeline: needsRefund ? '3-5 business days' : null
  });
}));

// @route   PUT /orders/:id/payment-failed
// @desc    Mark order as failed due to payment failure
// @access  Private
router.put("/:id/payment-failed", protect, validatePaymentFailed, asyncHandler(async (req, res) => {
  const { reason, paymentId, errorDescription } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user owns the order
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized'
    });
  }

  // Only allow if pending
  if (order.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot mark order as failed. Current status: ${order.status}`
    });
  }

  // Use status service to update
  const result = await orderStatusService.updateOrderStatus(order._id.toString(), 'failed', {
    userId: req.user.id,
    isAdmin: req.user.role === 'admin',
    reason: reason || 'payment_failed',
    notes: `Payment failed reported by client. ${errorDescription ? 'Error: ' + errorDescription : ''}`,
    metadata: {
      paymentId,
      errorDescription
    }
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    message: 'Order marked as failed',
    order: result.order
  });
}));

// @route   DELETE /orders/:id
// @desc    Delete an order (Only cancelled or failed orders)
// @access  Private
router.delete("/:id", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user owns the order (or is admin)
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to delete this order'
    });
  }

  // Only allow deleting cancelled or failed orders
  const deletableStatuses = ['cancelled', 'failed'];
  if (!deletableStatuses.includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete order with status '${order.status}'. Only cancelled or failed orders can be deleted.`
    });
  }

  await order.deleteOne();

  res.json({
    success: true,
    message: 'Order deleted successfully',
    id: req.params.id
  });
}));

// @route   PUT /orders/:id/status
// @desc    Update order status with validation (Admin only)
// @access  Private/Admin
router.put("/:id/status", protect, admin, validateOrderStatusUpdate, asyncHandler(async (req, res) => {
  const { status, reason, notes, trackingNumber, estimatedDelivery, metadata } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  // Update status using the service
  const result = await orderStatusService.updateOrderStatus(req.params.id, status, {
    userId: req.user.id,
    isAdmin: true,
    reason,
    notes,
    metadata
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  const order = result.order;
  
  // Update additional fields if provided
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;
  await order.save();

  res.json({
    success: true,
    message: result.message,
    order
  });
}));

// @route   POST /orders/bulk/status
// @desc    Bulk update order status (Admin only)
// @access  Private/Admin
router.post("/bulk/status", protect, admin, validateBulkStatusUpdate, asyncHandler(async (req, res) => {
  const { orderIds, status, reason, notes } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No order IDs provided'
    });
  }

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  const results = {
    successful: [],
    failed: []
  };

  // Process updates in parallel
  await Promise.all(orderIds.map(async (orderId) => {
    try {
      const result = await orderStatusService.updateOrderStatus(orderId, status, {
        userId: req.user.id,
        isAdmin: true,
        reason: reason || 'bulk_admin_update',
        notes: notes || 'Bulk status update from admin panel'
      });

      if (result.success) {
        results.successful.push({ orderId, status });
      } else {
        results.failed.push({ orderId, error: result.message });
      }
    } catch (error) {
      results.failed.push({ orderId, error: error.message });
    }
  }));

  res.json({
    success: true,
    message: `Processed ${orderIds.length} orders`,
    results
  });
}));

// @route   POST /orders/bulk/delete
// @desc    Bulk delete orders (Admin only, restricted to cancelled/failed)
// @access  Private/Admin
router.post("/bulk/delete", protect, admin, validateBulkDelete, asyncHandler(async (req, res) => {
  const { orderIds } = req.body;

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No order IDs provided'
    });
  }

  const results = {
    successful: [],
    failed: []
  };

  // Only allow deleting cancelled or failed orders
  const deletableStatuses = ['cancelled', 'failed'];

  // Process deletes in parallel
  await Promise.all(orderIds.map(async (orderId) => {
    try {
      const order = await Order.findById(orderId);
      
      if (!order) {
        results.failed.push({ orderId, error: 'Order not found' });
        return;
      }

      if (!deletableStatuses.includes(order.status)) {
        results.failed.push({ 
          orderId, 
          error: `Cannot delete order with status '${order.status}'. Only cancelled or failed orders can be deleted.` 
        });
        return;
      }

      await order.deleteOne();
      results.successful.push(orderId);
      
      // Log audit event
      if (req.user) {
        // We need to import auditLogger if we want to use it, but it's not imported in this file yet.
        // Assuming we might want to add it later or if it's available globally (it's not).
        // For now, skipping explicit audit log call inside this route as it wasn't requested, 
        // but it's good practice. I'll stick to the core requirement.
      }

    } catch (error) {
      results.failed.push({ orderId, error: error.message });
    }
  }));

  res.json({
    success: true,
    message: `Processed ${orderIds.length} deletions`,
    results
  });
}));

// @route   GET /orders/:id/status-history
// @desc    Get status history for an order
// @access  Private
router.get("/:id/status-history", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user can only access their own orders (unless admin)
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }

  const result = await orderStatusService.getStatusHistory(req.params.id);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    currentStatus: result.currentStatus,
    history: result.history
  });
}));

// @route   GET /orders/:id/valid-transitions
// @desc    Get valid next statuses for an order
// @access  Private
router.get("/:id/valid-transitions", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user can only access their own orders (unless admin)
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }

  const isAdmin = req.user.role === 'admin';
  const validStatuses = orderStatusService.getValidNextStatuses(order.status, isAdmin);
  const validReasons = {};

  // Get valid reasons for each possible next status
  validStatuses.forEach(status => {
    validReasons[status] = orderStatusService.getValidReasons(status);
  });

  res.json({
    success: true,
    currentStatus: order.status,
    validNextStatuses: validStatuses,
    validReasons: validReasons
  });
}));

// @route   GET /orders/analytics/status-stats
// @desc    Get order status statistics (Admin only)
// @access  Private/Admin
router.get("/analytics/status-stats", protect, admin, validateAnalyticsQuery, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderStatusService.getStatusStatistics(filter);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    statistics: result.statistics
  });
}));

// @route   GET /orders/analytics/fulfillment-metrics
// @desc    Get fulfillment performance metrics (Admin only)
// @access  Private/Admin
router.get("/analytics/fulfillment-metrics", protect, admin, validateAnalyticsQuery, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderStatusService.getFulfillmentMetrics(filter);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    metrics: result.metrics
  });
}));

// ========================================
// TRACKING ENDPOINTS
// ========================================

// @route   POST /orders/:id/tracking
// @desc    Add tracking information to order (Admin only)
// @access  Private/Admin
router.post("/:id/tracking", protect, admin, validateTrackingInfo, asyncHandler(async (req, res) => {
  const { trackingNumber, carrierCode, notes } = req.body;

  if (!carrierCode) {
    return res.status(400).json({
      success: false,
      message: 'Carrier code is required'
    });
  }

  // Generate tracking number if not provided
  const finalTrackingNumber = trackingNumber || 
    orderTrackingService.generateTrackingNumber(carrierCode, req.params.id);

  const result = await orderTrackingService.addTrackingInfo(req.params.id, {
    trackingNumber: finalTrackingNumber,
    carrierCode,
    notes
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    message: 'Tracking information added successfully',
    trackingNumber: finalTrackingNumber,
    trackingUrl: result.trackingUrl,
    estimatedDelivery: result.estimatedDelivery,
    order: result.order
  });
}));

// @route   GET /orders/:id/tracking
// @desc    Get tracking history for an order
// @access  Private
router.get("/:id/tracking", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user can only access their own orders (unless admin)
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }

  const result = await orderTrackingService.getTrackingHistory(req.params.id);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    ...result
  });
}));

// @route   POST /orders/:id/tracking/events
// @desc    Add tracking event to order (Admin only)
// @access  Private/Admin
router.post("/:id/tracking/events", protect, admin, validateTrackingEvent, asyncHandler(async (req, res) => {
  const { status, location, description, scannedBy, timestamp } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  const result = await orderTrackingService.addTrackingEvent(req.params.id, {
    status,
    location,
    description,
    scannedBy,
    timestamp
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    message: 'Tracking event added successfully',
    event: result.event,
    order: result.order
  });
}));

// @route   GET /orders/track/:trackingNumber
// @desc    Public tracking lookup by tracking number
// @access  Public
router.get("/track/:trackingNumber", asyncHandler(async (req, res) => {
  const result = await orderTrackingService.trackByNumber(req.params.trackingNumber);

  if (!result.success) {
    return res.status(404).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    ...result
  });
}));

// @route   GET /orders/tracking/carriers
// @desc    Get list of supported carriers
// @access  Public
router.get("/tracking/carriers", asyncHandler(async (req, res) => {
  const carriers = orderTrackingService.getSupportedCarriers();

  res.json({
    success: true,
    carriers
  });
}));

// @route   POST /orders/:id/tracking/simulate
// @desc    Simulate tracking events for testing (Admin only)
// @access  Private/Admin
router.post("/:id/tracking/simulate", protect, admin, asyncHandler(async (req, res) => {
  const { scenario } = req.body;

  const result = await orderTrackingService.simulateTracking(
    req.params.id,
    scenario || 'normal_delivery'
  );

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    message: result.message,
    eventsAdded: result.eventsAdded
  });
}));

// @route   GET /orders/analytics/tracking-stats
// @desc    Get tracking statistics by carrier (Admin only)
// @access  Private/Admin
router.get("/analytics/tracking-stats", protect, admin, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filter = {};
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const result = await orderTrackingService.getTrackingStatistics(filter);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message
    });
  }

  res.json({
    success: true,
    statistics: result.statistics
  });
}));

// @route   GET /orders/admin/all
// @desc    Get all orders (Admin only)
// @access  Private/Admin
router.get("/admin/all", protect, admin, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const query = status ? { status } : {};
  const skip = (Number(page) - 1) * Number(limit);

  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('items.product', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Order.countDocuments(query);

  res.json({
    success: true,
    count: orders.length,
    total,
    pages: Math.ceil(total / Number(limit)),
    currentPage: Number(page),
    orders
  });
}));

// ========================================
// RETURN REQUEST ENDPOINTS
// ========================================

// @route   POST /orders/:id/return
// @desc    Submit return request for delivered order
// @access  Private
router.post("/:id/return", protect, validateIdParam, validateOrderReturn, asyncHandler(async (req, res) => {
  const { items, reason, description, images } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  // Verify user owns the order
  if (order.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }
  
  // Verify order is delivered
  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only delivered orders can be returned'
    });
  }
  
  // Check if already has pending/approved return
  if (order.returnRequest && ['pending', 'approved', 'item_received'].includes(order.returnRequest.status)) {
    return res.status(400).json({
      success: false,
      message: 'A return request is already in progress for this order'
    });
  }
  
  // Verify return window (30 days from delivery)
  const daysSinceDelivery = (new Date() - new Date(order.deliveredAt || order.fulfillmentMetrics?.deliveredAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > 30) {
    return res.status(400).json({
      success: false,
      message: 'Return window has expired. Returns must be requested within 30 days of delivery.'
    });
  }
  
  // Create return request
  const returnRequest = {
    items: items.map(item => ({
      product: item.productId,
      quantity: item.quantity,
      reason: item.reason || reason,
      condition: item.condition || 'opened'
    })),
    status: 'pending',
    reason,
    description,
    images: images || [],
    requestedAt: new Date()
  };
  
  order.returnRequest = returnRequest;
  await order.save();
  
  res.status(201).json({
    success: true,
    message: 'Return request submitted successfully',
    returnRequest: order.returnRequest
  });
}));

// @route   GET /orders/:id/return
// @desc    Get return request details
// @access  Private
router.get("/:id/return", protect, validateIdParam, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  // Verify user owns the order
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this order'
    });
  }
  
  if (!order.returnRequest) {
    return res.status(404).json({
      success: false,
      message: 'No return request found for this order'
    });
  }
  
  res.json({
    success: true,
    returnRequest: order.returnRequest
  });
}));

// @route   PUT /orders/:id/return/status
// @desc    Update return request status (Admin only)
// @access  Private/Admin
router.put("/:id/return/status", protect, admin, asyncHandler(async (req, res) => {
  const { status, adminNotes, refundAmount } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  if (!order.returnRequest) {
    return res.status(404).json({
      success: false,
      message: 'No return request found for this order'
    });
  }
  
  // Update status
  order.returnRequest.status = status;
  if (adminNotes) {
    order.returnRequest.adminNotes = adminNotes;
  }
  
  // If approved and refund amount provided, process refund logic here
  // (Simplified for now - just recording it)
  if (status === 'approved' && refundAmount) {
    order.refundDetails = {
      amount: refundAmount,
      status: 'pending',
      refundMethod: 'original_payment',
      requestedAt: new Date()
    };
    
    // Also update order status to refunded if full refund
    if (refundAmount >= order.totalAmount) {
      await orderStatusService.updateOrderStatus(order._id, 'refunded', {
        userId: req.user.id,
        isAdmin: true,
        reason: 'return_approved',
        notes: 'Return request approved and refunded'
      });
      // Re-fetch to get updated status
      const updatedOrder = await Order.findById(req.params.id);
      return res.json({
        success: true,
        message: 'Return request updated and order refunded',
        order: updatedOrder
      });
    }
  }
  
  await order.save();
  
  res.json({
    success: true,
    message: 'Return request status updated',
    returnRequest: order.returnRequest
  });
}));

export default router;