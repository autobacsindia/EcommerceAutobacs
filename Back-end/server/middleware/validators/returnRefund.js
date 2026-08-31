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

// Admin: record a return handled off-platform. Shape only — the controller owns the
// order/product context and the money. Note the ABSENT rules: no video, no proof of
// purchase, no window. Those are exactly what an offline return cannot have.
export const validateOfflineReturnCreate = [
  body('orderId')
    .notEmpty().withMessage('Valid Order ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Select at least one item to return'),
  // A line is identified by its own `itemId` (the unambiguous handle — two variants of
  // one product share a product id) OR by productId. Neither is individually mandatory,
  // but one must be present; the controller resolves the actual order line and owns the
  // friendlier errors, including the imported-line case that has no productId at all.
  body('items.*').custom((item) => {
    if (!item || (!item.itemId && !item.productId)) {
      throw new Error('Each item needs an order line id or a product id');
    }
    return true;
  }),
  body('items.*.itemId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid order line id'),
  body('items.*.productId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.variantId')
    .optional({ values: 'falsy' })
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid variant id'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('items.*.reason')
    .isIn(RETURN_REASONS)
    .withMessage('Returns are only accepted for a wrong item, transit damage, or a manufacturing defect'),
  body('note')
    .isString().withMessage('A note describing what happened is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A note describing what happened is required')
    .isLength({ max: 2000 }).withMessage('Note cannot exceed 2000 characters'),
  body('shippingBorneBy').optional().isIn(['roavion', 'customer']).withMessage('Invalid shipping-borne-by value'),
  body('markReturned').optional().isBoolean().withMessage('markReturned must be true or false'),
  body('notifyCustomer').optional().isBoolean().withMessage('notifyCustomer must be true or false'),
  validateRequest
];

// Admin: mark a return received with the courier + inspection steps skipped.
export const validateOfflineReceived = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Return Request ID'),
  body('note')
    .isString().withMessage('A note is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A note is required')
    .isLength({ max: 2000 }).withMessage('Note cannot exceed 2000 characters'),
  body('notifyCustomer').optional().isBoolean().withMessage('notifyCustomer must be true or false'),
  validateRequest
];

// Admin: initiate a refund. `method: 'offline'` records money already paid back by
// hand and REQUIRES a reference — that string is the only evidence it moved, since
// there is no gateway record to reconcile against. Amounts are not validated here on
// purpose: they are recomputed from the order in the controller and never trusted.
export const validateReturnRefundBody = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Return Request ID'),
  body('method').optional().isIn(['original_payment', 'offline']).withMessage('Invalid refund method'),
  body('offlineMethod')
    .if(body('method').equals('offline'))
    .isIn(['cash', 'bank_transfer', 'upi', 'cheque', 'other'])
    .withMessage('How the money was paid back is required'),
  body('reference')
    .if(body('method').equals('offline'))
    .isString().withMessage('A reference (UTR, cheque or receipt number) is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A reference (UTR, cheque or receipt number) is required')
    .isLength({ max: 120 }).withMessage('Reference cannot exceed 120 characters'),
  body('paidAt').optional({ values: 'falsy' }).isISO8601().withMessage('The payout date is not a valid date'),
  body('shippingDeduction').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Shipping deduction cannot be negative'),
  body('restockingDeduction').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Restocking deduction cannot be negative'),
  body('notifyCustomer').optional().isBoolean().withMessage('notifyCustomer must be true or false'),
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
