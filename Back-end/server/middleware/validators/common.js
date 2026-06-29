import { param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateIdParam = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid ID format'),
  validateRequest
];

export const validatePagination = [
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

// Order analytics endpoints filter by an explicit startDate/endDate range.
// Distinct from the dashboard analytics validator in ./analytics.js (period-based);
// kept separate to avoid a name collision in the validators barrel.
export const validateOrderAnalyticsQuery = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  validateRequest
];

export const validateTrackingNumberParam = [
  param('trackingNumber')
    .notEmpty()
    .withMessage('Tracking number is required')
    .trim(),
  validateRequest
];

export const validateTokenQuery = [
  query('token')
    .notEmpty()
    .withMessage('Token is required')
    .trim(),
  validateRequest
];
