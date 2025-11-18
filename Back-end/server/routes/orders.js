import express from "express";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateOrder } from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /orders
// @desc    Get all orders for logged-in user
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user.id })
    .populate('items.product', 'name images')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    count: orders.length,
    orders
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
// @desc    Cancel an order
// @access  Private
router.put("/:id/cancel", protect, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Ensure user can only cancel their own orders
  if (order.user.toString() !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to cancel this order'
    });
  }

  // Only allow cancellation if order is pending or confirmed
  if (!['pending', 'confirmed'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel order with status: ${order.status}`
    });
  }

  // Restore product stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity }
    });
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason || 'Cancelled by user';
  await order.save();

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order
  });
}));

// @route   PUT /orders/:id/status
// @desc    Update order status (Admin only)
// @access  Private/Admin
router.put("/:id/status", protect, admin, asyncHandler(async (req, res) => {
  const { status, trackingNumber, estimatedDelivery } = req.body;

  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status'
    });
  }

  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  order.status = status;
  
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;
  if (status === 'delivered') order.deliveredAt = new Date();

  await order.save();

  res.json({
    success: true,
    message: 'Order status updated successfully',
    order
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
