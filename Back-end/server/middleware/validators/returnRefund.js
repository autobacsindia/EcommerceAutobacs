import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateReturnRequest = [
  body('orderId')
    .notEmpty()
    .withMessage('Valid Order ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('type')
    .notEmpty()
    .withMessage('Return type is required')
    .isIn(['return', 'exchange'])
    .withMessage('Invalid return type'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items must be an array with at least one item'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('Valid Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('items.*.reason')
    .isIn(['defective', 'wrong_item', 'other'])
    .withMessage('Invalid reason'),
  body('items.*.condition')
    .optional()
    .isIn(['unopened', 'opened', 'damaged'])
    .withMessage('Invalid condition'),
  body('refundMethod')
    .optional()
    .isIn(['store_credit', 'original_payment'])
    .withMessage('Invalid refund method'),
  body('comments')
    .optional()
    .trim(),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  validateRequest
];

export const validateOrderReturn = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item must be selected for return'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('reason')
    .notEmpty()
    .withMessage('Return reason is required')
    .isIn(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'])
    .withMessage('Invalid return reason'),
  body('description')
    .optional()
    .trim(),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  validateRequest
];

export const validateReturnStatusUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Return Request ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'approved', 'rejected', 'completed', 'cancelled'])
    .withMessage('Invalid return status'),
  body('adminNotes')
    .optional()
    .trim(),
  body('rejectionReason')
    .if(body('status').equals('rejected'))
    .notEmpty()
    .withMessage('Rejection reason is required when rejecting a request')
    .trim(),
  validateRequest
];
