import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateBrand = [
  body('name')
    .notEmpty()
    .withMessage('Brand name is required')
    .trim(),
  body('logo')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  validateRequest
];

export const validateBrandUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Brand ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Brand name cannot be empty'),
  body('logo')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  validateRequest
];

export const validateBrandProductMap = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Brand ID'),
  body('productIds')
    .isArray({ min: 1 })
    .withMessage('Product IDs array is required and must not be empty'),
  body('productIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID in list'),
  validateRequest
];

export const validateBrandParam = [
  param('brandName')
    .notEmpty()
    .withMessage('Brand name is required')
    .trim(),
  validateRequest
];

export const validateBrandQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  validateRequest
];
