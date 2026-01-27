import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { body, validationResult } from "express-validator";
import razorpayService from "../services/razorpayService.js";
import Order from "../models/Order.js";
import { paymentSessionKeepAlive, attachTokenRefreshInfo } from "../middleware/sessionKeepAlive.js";

const router = express.Router();

// Apply session keep-alive and token refresh middleware to all payment routes
router.use(paymentSessionKeepAlive);
router.use(attachTokenRefreshInfo);

// @route   POST /razorpay/create-order
// @desc    Create a Razorpay order
// @access  Private
router.post("/create-order", protect, [
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').optional().isString().withMessage('Currency must be a string'),
  body('receipt').optional().isString().withMessage('Receipt must be a string')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const { orderId, amount, currency, receipt } = req.body;
    
    // Verify the order belongs to the user
    const order = await Order.findOne({ _id: orderId, user: req.user.id });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or does not belong to user'
      });
    }
    
    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder({
      orderId,
      amount,
      currency,
      receipt
    });
    
    res.json({
      success: true,
      data: razorpayOrder
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

// @route   POST /razorpay/verify-payment
// @desc    Verify Razorpay payment and update order status
// @access  Private
router.post("/verify-payment", protect, [
  body('razorpay_order_id').notEmpty().withMessage('Razorpay order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Razorpay payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Razorpay signature is required'),
  body('orderId').optional().isString().withMessage('Order ID must be a string')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;
    
    // Verify payment signature
    const verificationResult = await razorpayService.verifyPayment({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    });
    
    if (!verificationResult.success || !verificationResult.verified) {
      return res.status(400).json({
        success: false,
        message: verificationResult.message || 'Payment verification failed'
      });
    }
    
    // Find order
    let order;
    if (orderId) {
      order = await Order.findById(orderId);
    } else {
      // Fallback: try to find by gatewayOrderId (will likely fail if Payment record doesn't exist yet)
      order = await Order.findOne({ 'payment.gatewayOrderId': razorpay_order_id });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Process successful payment
    const result = await razorpayService.processPaymentSuccess(
      order._id.toString(),
      verificationResult.payment,
      req.user.id
    );
    
    res.json({
      success: true,
      message: 'Payment verified and order updated',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

// @route   POST /razorpay/webhook
// @desc    Handle Razorpay webhook events
// @access  Public (secured by signature verification)
router.post("/webhook", express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  try {
    // Get signature from header
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing Razorpay signature'
      });
    }
    
    // Handle webhook
    const result = await razorpayService.handleWebhook(req.body, signature);
    
    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}));

export default router;