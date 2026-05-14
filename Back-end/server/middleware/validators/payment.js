import { body } from 'express-validator';
import { validateRequest } from '../validateRequest.js';

export const validatePaymentMethod = [
  body('paymentMethod').notEmpty().withMessage('Payment method is required'),
  body('paymentGateway').notEmpty().withMessage('Payment gateway is required'),
  validateRequest
];

export const validateRazorpayOrder = [
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').optional().isString().withMessage('Currency must be a string'),
  body('receipt').optional().isString().withMessage('Receipt must be a string'),
  validateRequest
];

export const validateRazorpayVerification = [
  body('razorpay_order_id').notEmpty().withMessage('Razorpay order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Razorpay payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Razorpay signature is required'),
  body('orderId').optional().isString().withMessage('Order ID must be a string'),
  validateRequest
];
