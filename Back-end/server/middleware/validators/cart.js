import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

// Optional variant selector — present only for variable products. When sent it
// must be a valid ObjectId (Product.variants[]._id); the route enforces that a
// variable product actually requires one.
const optionalVariantIdBody = body('variantId')
  .optional({ nullable: true })
  .custom((value) => value === '' || mongoose.Types.ObjectId.isValid(value))
  .withMessage('Invalid variant ID');

export const validateCartItem = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  optionalVariantIdBody,
  body('quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  validateRequest
];

export const validateCartUpdate = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  optionalVariantIdBody,
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  validateRequest
];

export const validateCartProductIdParam = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];

export const validateRouteProductId = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];
