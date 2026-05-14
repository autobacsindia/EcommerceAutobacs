import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateWarehouse = [
  body('name')
    .notEmpty()
    .withMessage('Warehouse name is required')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Name too long'),
  body('code')
    .notEmpty()
    .withMessage('Warehouse code is required')
    .trim()
    .isUppercase()
    .withMessage('Code must be uppercase')
    .isLength({ max: 20 })
    .withMessage('Code too long'),
  body('type')
    .notEmpty()
    .withMessage('Type is required')
    .isIn(['warehouse', 'store', 'hub'])
    .withMessage('Invalid warehouse type'),
  body('location.address')
    .notEmpty()
    .withMessage('Address is required'),
  body('location.city')
    .notEmpty()
    .withMessage('City is required'),
  body('location.state')
    .notEmpty()
    .withMessage('State is required'),
  body('location.postalCode')
    .notEmpty()
    .withMessage('Postal code is required'),
  body('location.coordinates.coordinates')
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be [longitude, latitude]'),
  validateRequest
];

export const validateWarehouseUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }),
  body('code')
    .optional()
    .trim()
    .isUppercase()
    .isLength({ max: 20 }),
  body('type')
    .optional()
    .isIn(['warehouse', 'store', 'hub']),
  validateRequest
];

export const validateWarehouseInventoryQuery = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  query('page')
    .optional()
    .isInt({ min: 1 }),
  query('limit')
    .optional()
    .isInt({ min: 1 }),
  query('productId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  query('lowStock')
    .optional()
    .isBoolean(),
  validateRequest
];

export const validateWarehouseStockUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  body('operation')
    .optional()
    .isIn(['add', 'subtract', 'set'])
    .withMessage('Invalid operation'),
  validateRequest
];

export const validateWarehouseSelection = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order items must be a non-empty array'),
  body('deliveryAddress')
    .notEmpty()
    .withMessage('Delivery address is required'),
  validateRequest
];

export const validateWarehouseQuery = [
  query('status')
    .optional()
    .trim(),
  query('type')
    .optional()
    .trim(),
  query('city')
    .optional()
    .trim(),
  validateRequest
];
