import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateCategory = [
  body('name')
    .notEmpty()
    .withMessage('Category name is required')
    .trim(),
  body('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('description')
    .optional()
    .trim(),
  body('parent')
    .optional()
    .custom((value) => !value || mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Parent Category ID'),
  body('order')
    .optional()
    .isInt()
    .withMessage('Order must be an integer'),
  body('isFeatured')
    .optional()
    .isBoolean()
    .withMessage('isFeatured must be a boolean'),
  validateRequest
];

export const validateCategoryUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Category ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Category name cannot be empty'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('parent')
    .optional()
    .custom((value) => !value || mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Parent Category ID'),
  body('order')
    .optional()
    .isInt()
    .withMessage('Order must be an integer'),
  body('isFeatured')
    .optional()
    .isBoolean()
    .withMessage('isFeatured must be a boolean'),
  validateRequest
];

export const validateSlugParam = [
  param('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim(),
  validateRequest
];
