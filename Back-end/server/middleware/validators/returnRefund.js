import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';
import { RETURN_REASONS } from '../../config/returnPolicy.js';

// Create a return. Shape validation only — business rules (4-day window,
// non-returnable products, mandatory-doc verification against Cloudinary) live in
// the controller, which owns the order + product context.
export const validateReturnRequest = [
  body('orderId')
    .notEmpty()
    .withMessage('Valid Order ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Select at least one item to return'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('Valid Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('items.*.reason')
    .isIn(RETURN_REASONS)
    .withMessage('Returns are only accepted for a wrong item, transit damage, or a manufacturing defect'),
  body('problemDescription')
    .isString().withMessage('A problem description is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A problem description is required')
    .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),
  body('video')
    .notEmpty().withMessage('A continuous unboxing video is required'),
  body('video.publicId')
    .isString().withMessage('A continuous unboxing video is required'),
  body('proofOfPurchase')
    .notEmpty().withMessage('Proof of purchase is required'),
  body('proofOfPurchase.publicId')
    .isString().withMessage('Proof of purchase is required'),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  validateRequest
];

// Admin approve/reject at review.
export const validateReturnReview = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Return Request ID'),
  body('decision')
    .isIn(['approve', 'reject'])
    .withMessage('Decision must be "approve" or "reject"'),
  body('shippingBorneBy')
    .optional()
    .isIn(['roavion', 'customer'])
    .withMessage('Invalid shipping-borne-by value'),
  body('rejectionReason')
    .if(body('decision').equals('reject'))
    .notEmpty()
    .withMessage('A rejection reason is required when rejecting')
    .trim(),
  body('adminNotes').optional().trim(),
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
