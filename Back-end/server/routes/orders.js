import express from "express";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateOrder } from "../middleware/validationMiddleware.js";
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
router.get("/", protect, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const orders = await Order.find({ user: req.user.id })
    .populate('items.product', 'name images')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

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

// @route   GET /orders/:id
// @desc    Get order by ID
// @access  Private
router.get("/:id", protect, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'name images price')
    .populate('user', 'name email');

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
router.put("/:id/cancel", protect, validateCancellation, asyncHandler(async (req, res) => {
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

// @route   PUT /orders/:id/status
// @desc    Update order status with validation (Admin only)
// @access  Private/Admin
router.put("/:id/status", protect, admin, asyncHandler(async (req, res) => {
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

// @route   GET /orders/:id/status-history
// @desc    Get status history for an order
// @access  Private
router.get("/:id/status-history", protect, asyncHandler(async (req, res) => {
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
router.get("/:id/valid-transitions", protect, asyncHandler(async (req, res) => {
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
router.get("/analytics/status-stats", protect, admin, asyncHandler(async (req, res) => {
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
router.get("/analytics/fulfillment-metrics", protect, admin, asyncHandler(async (req, res) => {
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
router.post("/:id/tracking", protect, admin, asyncHandler(async (req, res) => {
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
router.get("/:id/tracking", protect, asyncHandler(async (req, res) => {
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
router.post("/:id/tracking/events", protect, admin, asyncHandler(async (req, res) => {
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
router.post("/:id/return", protect, asyncHandler(async (req, res) => {
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
  
  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'At least one item must be selected for return'
    });
  }
  
  // Validate reason
  const validReasons = ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'];
  if (!reason || !validReasons.includes(reason)) {
    return res.status(400).json({
      success: false,
      message: `Invalid return reason. Must be one of: ${validReasons.join(', ')}`
    });
  }
  
  // Validate images (max 5, each < 5MB)
  if (images && images.length > 5) {
    return res.status(400).json({
      success: false,
      message: 'Maximum 5 images allowed per return request'
    });
  }
  
  // Create return request
  order.returnRequest = {
    requestedAt: new Date(),
    requestedBy: req.user.id,
    reason,
    status: 'pending',
    items: items.map(item => ({
      product: item.product,
      quantity: item.quantity,
      reason: item.reason || reason
    })),
    images: images || [],
    description
  };
  
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
router.get("/:id/return", protect, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('returnRequest.requestedBy', 'name email')
    .populate('returnRequest.approvedBy', 'name email')
    .populate('returnRequest.items.product', 'name images price');
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  // Verify access (order owner or admin)
  if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to access this return request'
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

// @route   PUT /orders/:id/return/approve
// @desc    Approve return request (Admin only)
// @access  Private/Admin
router.put("/:id/return/approve", protect, admin, asyncHandler(async (req, res) => {
  const { notes, returnShippingLabel } = req.body;
  
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
      message: 'No return request found'
    });
  }
  
  if (order.returnRequest.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot approve return request with status: ${order.returnRequest.status}`
    });
  }
  
  order.returnRequest.status = 'approved';
  order.returnRequest.approvedBy = req.user.id;
  order.returnRequest.approvedAt = new Date();
  order.returnRequest.adminNotes = notes;
  order.returnRequest.returnShippingLabel = returnShippingLabel;
  
  await order.save();
  
  res.json({
    success: true,
    message: 'Return request approved successfully',
    returnRequest: order.returnRequest
  });
}));

// @route   PUT /orders/:id/return/reject
// @desc    Reject return request (Admin only)
// @access  Private/Admin
router.put("/:id/return/reject", protect, admin, asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
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
      message: 'No return request found'
    });
  }
  
  if (order.returnRequest.status !== 'pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot reject return request with status: ${order.returnRequest.status}`
    });
  }
  
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: 'Rejection reason is required'
    });
  }
  
  order.returnRequest.status = 'rejected';
  order.returnRequest.approvedBy = req.user.id;
  order.returnRequest.approvedAt = new Date();
  order.returnRequest.rejectedReason = reason;
  
  await order.save();
  
  res.json({
    success: true,
    message: 'Return request rejected',
    returnRequest: order.returnRequest
  });
}));

// @route   PUT /orders/:id/return/received
// @desc    Mark return item as received (Admin only)
// @access  Private/Admin
router.put("/:id/return/received", protect, admin, asyncHandler(async (req, res) => {
  const { inspectionNotes } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  if (!order.returnRequest || order.returnRequest.status !== 'approved') {
    return res.status(400).json({
      success: false,
      message: 'Return request must be approved before marking as received'
    });
  }
  
  order.returnRequest.status = 'item_received';
  order.returnRequest.itemReceivedAt = new Date();
  order.returnRequest.inspectionNotes = inspectionNotes;
  
  await order.save();
  
  res.json({
    success: true,
    message: 'Return item marked as received',
    returnRequest: order.returnRequest
  });
}));

// @route   POST /orders/:id/return/refund
// @desc    Process refund for returned items (Admin only)
// @access  Private/Admin
router.post("/:id/return/refund", protect, admin, asyncHandler(async (req, res) => {
  const { amount, refundType, refundMethod, notes, itemsRefunded } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }
  
  if (!order.returnRequest || order.returnRequest.status !== 'item_received') {
    return res.status(400).json({
      success: false,
      message: 'Return items must be received before processing refund'
    });
  }
  
  // Validate refund amount
  if (!amount || amount <= 0 || amount > order.totalAmount) {
    return res.status(400).json({
      success: false,
      message: 'Invalid refund amount'
    });
  }
  
  // Validate refund type
  const validRefundTypes = ['full', 'partial'];
  if (!refundType || !validRefundTypes.includes(refundType)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid refund type. Must be full or partial'
    });
  }
  
  // Validate refund method
  const validRefundMethods = ['original_payment', 'store_credit', 'bank_transfer'];
  if (!refundMethod || !validRefundMethods.includes(refundMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid refund method'
    });
  }
  
  // Create refund record
  order.refundDetails = {
    requestedAt: new Date(),
    amount,
    refundType,
    refundMethod,
    itemsRefunded: itemsRefunded || order.returnRequest.items,
    status: 'pending',
    processedBy: req.user.id,
    notes
  };
  
  // Update return request status
  order.returnRequest.status = 'refund_processed';
  
  await order.save();
  
  res.status(201).json({
    success: true,
    message: 'Refund initiated successfully',
    refundDetails: order.refundDetails
  });
}));

// @route   GET /orders/admin/returns
// @desc    Get all return requests (Admin only)
// @access  Private/Admin
router.get("/admin/returns", protect, admin, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  
  const query = {};
  if (status) {
    query['returnRequest.status'] = status;
  } else {
    // Only get orders with return requests
    query['returnRequest'] = { $exists: true, $ne: null };
  }
  
  const skip = (Number(page) - 1) * Number(limit);
  
  const orders = await Order.find(query)
    .populate('user', 'name email')
    .populate('returnRequest.requestedBy', 'name email')
    .populate('returnRequest.approvedBy', 'name email')
    .populate('returnRequest.items.product', 'name images price')
    .sort({ 'returnRequest.requestedAt': -1 })
    .skip(skip)
    .limit(Number(limit));
  
  const total = await Order.countDocuments(query);
  
  const returns = orders.map(order => ({
    orderId: order._id,
    orderNumber: order._id,
    user: order.user,
    totalAmount: order.totalAmount,
    returnRequest: order.returnRequest,
    refundDetails: order.refundDetails
  }));
  
  res.json({
    success: true,
    count: returns.length,
    total,
    pages: Math.ceil(total / Number(limit)),
    currentPage: Number(page),
    returns
  });
}));

export default router;
