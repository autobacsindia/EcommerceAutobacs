import asyncHandler from "../middleware/asyncHandler.js";
import ReturnRequest from "../models/ReturnRequest.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import emailHandler from "../services/emailHandler.js";

// @desc    Create a return request
// @route   POST /api/returns
// @access  Private
export const createReturnRequest = asyncHandler(async (req, res) => {
  const { orderId, items, type, reason, images, video, refundMethod } = req.body;
  const userId = req.user._id;

  const order = await Order.findOne({ _id: orderId, user: userId }).populate("items.product");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.status !== "delivered") {
    res.status(400);
    throw new Error("Only delivered orders can be returned");
  }

  // 1. Return Window Check (7 days)
  const deliveryDate = new Date(order.deliveredAt || order.updatedAt); // Fallback if deliveredAt not set
  const currentDate = new Date();
  const diffTime = Math.abs(currentDate - deliveryDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 7) {
    res.status(400);
    throw new Error("Return window closed. Returns are only allowed within 7 days of delivery.");
  }

  // 2. Eligibility Rules
  const returnItems = [];
  let totalRefundAmount = 0;

  for (const item of items) {
    const orderItem = order.items.find(oi => oi.product._id.toString() === item.productId);
    
    if (!orderItem) {
      continue; // Skip invalid items
    }

    // Check Category Eligibility (Mock logic based on product data or category names)
    // In a real app, fetch category and check flags. Here we use basic logic.
    const product = orderItem.product;
    // Assuming we might have categories populated or we check product tags/name
    // For now, let's assume if it's "Clearance" or "Electronic" in name/tags/category (simplified)
    
    // Check for previous return requests for this item
    const existingReturn = await ReturnRequest.findOne({
      order: orderId,
      "items.product": item.productId,
      status: { $ne: "cancelled" }
    });

    if (existingReturn) {
      res.status(400);
      throw new Error(`Return request already exists for product: ${product.name}`);
    }

    returnItems.push({
      product: item.productId,
      quantity: item.quantity,
      reason: reason,
      condition: item.condition || "opened"
    });

    totalRefundAmount += orderItem.price * item.quantity;
  }

  if (returnItems.length === 0) {
    res.status(400);
    throw new Error("No valid items to return");
  }

  const returnRequest = await ReturnRequest.create({
    order: orderId,
    user: userId,
    items: returnItems,
    type,
    status: "pending",
    images,
    video,
    refundMethod,
    refundAmount: totalRefundAmount,
    timeline: [{
      status: "pending",
      note: "Return request submitted",
      updatedBy: userId
    }]
  });

  // Update Order with return request details
  order.returnRequest = {
    requestedAt: new Date(),
    requestedBy: userId,
    reason: reason,
    status: "pending",
    items: returnItems.map(item => ({
      product: item.product,
      quantity: item.quantity,
      reason: item.reason
    })),
    images: images
  };
  await order.save();

  // Send Email Notification
  try {
    await emailHandler.sendEmail({
      to: req.user.email,
      subject: `Return Request Received - Order #${order.orderNumber || order._id}`,
      text: `Your return request for Order #${order.orderNumber || order._id} has been received and is under review.`
    });
  } catch (error) {
    console.error("Email send failed", error);
  }

  res.status(201).json(returnRequest);
});

// @desc    Get my return requests
// @route   GET /api/returns/my-returns
// @access  Private
export const getMyReturns = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const total = await ReturnRequest.countDocuments({ user: req.user._id });

  const returns = await ReturnRequest.find({ user: req.user._id })
    .populate("order", "orderNumber")
    .populate("items.product", "name image price")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  res.json({
    success: true,
    count: total,
    requests: returns,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalRequests: total,
      hasNext: Number(page) < Math.ceil(total / Number(limit)),
      hasPrev: Number(page) > 1
    }
  });
});

// @desc    Get all return requests (Admin)
// @route   GET /api/returns/admin/all
// @access  Private/Admin
export const getAllReturns = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  
  const query = {};
  if (status && status !== 'all') {
    query.status = status;
  }

  const total = await ReturnRequest.countDocuments(query);

  const returns = await ReturnRequest.find(query)
    .populate("user", "name email")
    .populate("order", "orderNumber")
    .populate("items.product", "name image")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));
    
  res.json({
    success: true,
    count: total,
    requests: returns,
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalReturns: total,
      hasNext: Number(page) < Math.ceil(total / Number(limit)),
      hasPrev: Number(page) > 1
    }
  });
});

// @desc    Update return request status (Admin)
// @route   PUT /api/returns/:id/status
// @access  Private/Admin
export const updateReturnStatus = asyncHandler(async (req, res) => {
  const { status, adminNotes, rejectionReason } = req.body;
  const returnRequest = await ReturnRequest.findById(req.params.id).populate("user");

  if (!returnRequest) {
    res.status(404);
    throw new Error("Return request not found");
  }

  const oldStatus = returnRequest.status;
  returnRequest.status = status;
  returnRequest.adminNotes = adminNotes || returnRequest.adminNotes;
  
  if (status === "rejected") {
    returnRequest.rejectionReason = rejectionReason;
  }

  returnRequest.timeline.push({
    status,
    note: adminNotes || `Status updated to ${status}`,
    updatedBy: req.user._id
  });

  // Handle Refund/Credit Logic if completed/approved
  if (status === "completed" && oldStatus !== "completed") {
    if (returnRequest.refundMethod === "store_credit") {
      const user = await User.findById(returnRequest.user._id);
      
      // Add to wallet
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + 6); // 6 months validity

      user.wallet.balance += returnRequest.refundAmount;
      user.wallet.transactions.push({
        type: "credit",
        amount: returnRequest.refundAmount,
        description: `Refund for Return #${returnRequest._id}`,
        referenceId: returnRequest._id,
        referenceModel: "ReturnRequest",
        expiryDate
      });

      await user.save();
    }
    // If original_payment, we assume external process or integration here
  }

  await returnRequest.save();

  // Update Order status
  await Order.findByIdAndUpdate(returnRequest.order, {
    "returnRequest.status": status
  });

  // Notify User
  try {
     await emailHandler.sendEmail({
      to: returnRequest.user.email,
      subject: `Return Request Update - ${status.toUpperCase()}`,
      text: `Your return request status has been updated to: ${status}.\n\nNotes: ${adminNotes || "None"}`
    });
  } catch (error) {
    console.error("Email send failed", error);
  }

  res.json(returnRequest);
});

// @desc    Get user wallet
// @route   GET /api/returns/wallet
// @access  Private
export const getWallet = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("wallet");
  res.json({
    success: true,
    wallet: user.wallet
  });
});
