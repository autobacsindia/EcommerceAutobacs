import express from "express";
import Payment from "../models/Payment.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validatePaymentMethod } from "../middleware/validationMiddleware.js";

const router = express.Router();

// @route   GET /payment-methods
// @desc    Get all payment methods for logged-in user
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  // Get unique payment methods for the user based on their payment history
  const payments = await Payment.find({ user: req.user.id, status: 'completed' })
    .sort({ createdAt: -1 })
    .select('paymentMethod paymentGateway paymentDetails createdAt');

  // Process payments to extract unique payment methods
  const paymentMethods = [];
  const seenMethods = new Set();

  for (const payment of payments) {
    // Create a unique identifier for this payment method
    let identifier;
    if (payment.paymentDetails && payment.paymentDetails.card) {
      identifier = `${payment.paymentMethod}-${payment.paymentDetails.card.brand}-${payment.paymentDetails.card.last4}`;
    } else {
      identifier = `${payment.paymentMethod}-${payment.paymentGateway}`;
    }

    // Only add if we haven't seen this method before
    if (!seenMethods.has(identifier)) {
      seenMethods.add(identifier);
      
      const method = {
        id: payment._id,
        paymentMethod: payment.paymentMethod,
        paymentGateway: payment.paymentGateway,
        createdAt: payment.createdAt
      };

      // Add card details if available
      if (payment.paymentDetails && payment.paymentDetails.card) {
        method.card = {
          brand: payment.paymentDetails.card.brand,
          last4: payment.paymentDetails.card.last4,
          expiryMonth: payment.paymentDetails.card.expiryMonth,
          expiryYear: payment.paymentDetails.card.expiryYear
        };
      }

      paymentMethods.push(method);
    }
  }

  res.json({
    success: true,
    count: paymentMethods.length,
    paymentMethods
  });
}));

// @route   POST /payment-methods
// @desc    Add a new payment method (in a real implementation, this would integrate with a payment gateway)
// @access  Private
router.post("/", protect, validatePaymentMethod, asyncHandler(async (req, res) => {
  const { paymentMethod, paymentGateway, cardDetails } = req.body;

  // In a real implementation, this would integrate with a payment gateway like Razorpay
  // to securely store payment methods. For now, we'll create a placeholder record.
  
  const paymentData = {
    user: req.user.id,
    amount: 0, // Placeholder amount for storing payment method
    paymentMethod,
    paymentGateway,
    status: 'completed', // Mark as completed for storage purposes
    paymentDetails: {}
  };

  // Add card details if provided
  if (cardDetails) {
    paymentData.paymentDetails.card = {
      brand: cardDetails.brand,
      last4: cardDetails.last4,
      expiryMonth: cardDetails.expiryMonth,
      expiryYear: cardDetails.expiryYear
    };
  }

  try {
    const payment = new Payment(paymentData);
    await payment.save();

    const paymentMethodResponse = {
      id: payment._id,
      paymentMethod: payment.paymentMethod,
      paymentGateway: payment.paymentGateway,
      createdAt: payment.createdAt
    };

    if (cardDetails) {
      paymentMethodResponse.card = {
        brand: cardDetails.brand,
        last4: cardDetails.last4,
        expiryMonth: cardDetails.expiryMonth,
        expiryYear: cardDetails.expiryYear
      };
    }

    res.status(201).json({
      success: true,
      message: 'Payment method added',
      paymentMethod: paymentMethodResponse
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method'
    });
  }
}));

export default router;
