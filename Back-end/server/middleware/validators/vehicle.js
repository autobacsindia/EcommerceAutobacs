import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateVehicleIdParam = [
  param('vehicleId')
    .notEmpty()
    .withMessage('Vehicle ID is required'),
  validateRequest
];

export const validateVehicle = [
  body('make')
    .notEmpty()
    .withMessage('Make is required')
    .trim(),
  body('model')
    .notEmpty()
    .withMessage('Model is required')
    .trim(),
  body('year')
    .notEmpty()
    .withMessage('Year is required')
    .trim(),
  body('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('variant')
    .optional()
    .trim(),
  body('image')
    .optional()
    .trim(),
  validateRequest
];

export const validateVehicleUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Vehicle ID'),
  body('make')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Make cannot be empty'),
  body('model')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Model cannot be empty'),
  body('year')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Year cannot be empty'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  validateRequest
];

export const validateVehicleProductMap = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Vehicle ID'),
  body('productIds')
    .isArray({ min: 1 })
    .withMessage('Product IDs array is required and must not be empty'),
  body('productIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID in list'),
  validateRequest
];

export const validateMakeModelParam = [
  param('make')
    .notEmpty()
    .withMessage('Make is required')
    .trim(),
  param('model')
    .notEmpty()
    .withMessage('Model is required')
    .trim(),
  validateRequest
];

export const validateVehicleQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  query('make').optional().trim(),
  query('model').optional().trim(),
  query('year').optional().trim(),
  validateRequest
];
