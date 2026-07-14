import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateOrder = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  body('shippingAddress')
    .notEmpty()
    .withMessage('Shipping address is required'),
  body('shippingAddress.fullName')
    .notEmpty()
    .withMessage('Full name is required in shipping address'),
  body('shippingAddress.phone')
    .notEmpty()
    .withMessage('Phone number is required'),
  body('shippingAddress.addressLine1')
    .notEmpty()
    .withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .notEmpty()
    .withMessage('City is required'),
  body('shippingAddress.state')
    .notEmpty()
    .withMessage('State is required'),
  body('shippingAddress.postalCode')
    .notEmpty()
    .withMessage('Postal code is required'),
  // discount is intentionally excluded — always ignored server-side
  body('shippingCost')
    .optional()
    .isFloat({ min: 0, max: 10000 })
    .withMessage('shippingCost must be a number between 0 and 10000'),
  body('tax')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('tax must be a non-negative number'),
  validateRequest
];

export const validateOrderStatusUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['awaiting_payment', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'])
    .withMessage('Invalid order status. Must be one of: awaiting_payment, processing, shipped, delivered, returned, cancelled'),
  body('reason')
    .optional()
    .trim(),
  body('notes')
    .optional()
    .trim(),
  // Tracking is mandatory to move an order to `shipped`; ignored for other
  // transitions. carrierCode must match a supported carrier so the email can
  // build a real "track your package" link.
  body('trackingNumber')
    .if(body('status').equals('shipped'))
    .trim()
    .notEmpty()
    .withMessage('Tracking number is required to mark an order as shipped'),
  body('carrierCode')
    .if(body('status').equals('shipped'))
    .trim()
    .notEmpty()
    .withMessage('Carrier is required to mark an order as shipped'),
  validateRequest
];

export const validateOrderCancellation = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('reason')
    .optional()
    .trim(),
  body('notes')
    .optional()
    .trim(),
  validateRequest
];

export const validateBulkStatusUpdate = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['processing', 'shipped', 'delivered', 'returned', 'cancelled'])
    .withMessage('Invalid order status'),
  validateRequest
];

export const validateBulkDelete = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  validateRequest
];

export const validateTrackingInfo = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('carrierCode')
    .notEmpty()
    .withMessage('Carrier code is required'),
  body('trackingNumber')
    .optional()
    .trim(),
  validateRequest
];

export const validateTrackingEvent = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Tracking status is required'),
  body('location')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  validateRequest
];

export const validatePaymentFailed = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('reason')
    .optional()
    .trim(),
  body('paymentId')
    .optional()
    .trim(),
  body('errorDescription')
    .optional()
    .trim(),
  validateRequest
];

export const validateAdminOrderQuery = [
  // status is a comma-joined multi-select; the controller filters out non-real
  // statuses, so we only trim here rather than reject.
  query('status')
    .optional()
    .trim(),
  query('orderNumber')
    .optional()
    .trim(),
  query('search')
    .optional()
    .trim(),
  query('customer')
    .optional()
    .trim(),
  query('startDate')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('startDate must be a valid date'),
  query('endDate')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('endDate must be a valid date'),
  query('minAmount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('minAmount must be a non-negative number'),
  query('maxAmount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('maxAmount must be a non-negative number'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'totalAmount', 'status'])
    .withMessage('sortBy must be one of: createdAt, totalAmount, status'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sortOrder must be asc or desc'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  validateRequest
];

export const validateTrackingSimulate = [
  body('scenario')
    .notEmpty()
    .withMessage('Scenario is required')
    .trim(),
  validateRequest
];

export const validateRefundsQuery = [
  query('status')
    .optional()
    .trim(),
  validateRequest
];
