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

const router = express.Router();

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
// @desc    Cancel an order with validation
// @access  Private
router.put("/:id/cancel", protect, validateCancellation, asyncHandler(async (req, res) => {
  const order = req.order; // Attached by validateCancellation middleware
  const { reason } = req.body;

  // Use status service to update to cancelled
  const result = await orderStatusService.updateOrderStatus(order._id.toString(), 'cancelled', {
    userId: req.user.id,
    isAdmin: req.user.role === 'admin',
    reason: reason || 'customer_request',
    notes: req.body.notes
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

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order: result.order
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

export default router;
