import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validatePinCodesUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Zone ID'),
  body('pinCodes')
    .notEmpty()
    .withMessage('Pin codes are required')
    .isArray({ min: 1 })
    .withMessage('Pin codes must be a non-empty array of strings'),
  body('pinCodes.*')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('All pin codes must be valid 6-digit format'),
  validateRequest
];

export const validateBulkImportPinCodes = [
  body('pinCodeData')
    .notEmpty()
    .withMessage('Pin code data is required')
    .isArray({ min: 1 })
    .withMessage('Pin code data must be a non-empty array'),
  body('pinCodeData.*.pinCode')
    .notEmpty()
    .withMessage('Pin code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('pinCodeData.*.zoneName')
    .notEmpty()
    .withMessage('Zone name is required')
    .trim(),
  validateRequest
];

export const validateLocationSelect = [
  body('placeId')
    .optional()
    .trim(),
  body('address')
    .optional(),
  body('coordinates')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) {
        return (
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] >= -180 && value[0] <= 180 &&
          value[1] >= -90 && value[1] <= 90
        );
      }
      if (value && typeof value === 'object') {
        const { latitude, longitude } = value;
        return (
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          longitude >= -180 && longitude <= 180 &&
          latitude >= -90 && latitude <= 90
        );
      }
      return false;
    })
    .withMessage('Coordinates must be [longitude, latitude] or { latitude, longitude }'),
  body('street')
    .optional()
    .trim(),
  validateRequest
];

export const validatePostalCode = [
  body('postalCode')
    .notEmpty()
    .withMessage('Postal code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid postal code format'),
  validateRequest
];

export const validatePostalCodeQuery = [
  query('postalCode')
    .notEmpty()
    .withMessage('Postal code is required')
    .trim(),
  validateRequest
];

export const validateLocationCoordinates = [
  query('latitude')
    .notEmpty()
    .withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  query('longitude')
    .notEmpty()
    .withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  query('maxDistance')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Max distance must be a positive integer'),
  validateRequest
];

export const validateRecentLocations = [
  query('limit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Limit must be a positive integer'),
  validateRequest
];

export const validatePinCodeParam = [
  param('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  validateRequest
];

export const validateServiceabilityCheck = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  validateRequest
];

export const validateDeliveryEstimate = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('orderDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid order date format'),
  validateRequest
];

export const validateShippingCost = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('weightKg')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be a positive number'),
  validateRequest
];

export const validateDeliveryZone = [
  body('name')
    .notEmpty()
    .withMessage('Zone name is required')
    .trim(),
  body('type')
    .notEmpty()
    .withMessage('Zone type is required')
    .isIn(['metro', 'tier1', 'tier2', 'remote'])
    .withMessage('Invalid zone type'),
  body('pinCodes')
    .optional()
    .isArray()
    .withMessage('Pin codes must be an array of strings'),
  body('cities')
    .optional()
    .isArray()
    .withMessage('Cities must be an array of strings'),
  body('states')
    .optional()
    .isArray()
    .withMessage('States must be an array of strings'),
  body('deliveryTime.minDays')
    .notEmpty()
    .withMessage('Minimum delivery days is required')
    .isInt({ min: 1 })
    .withMessage('Minimum delivery days must be at least 1'),
  body('deliveryTime.maxDays')
    .notEmpty()
    .withMessage('Maximum delivery days is required')
    .isInt({ min: 1 })
    .withMessage('Maximum delivery days must be at least 1')
    .custom((value, { req }) => {
      if (req.body.deliveryTime && value < req.body.deliveryTime.minDays) {
        throw new Error('Maximum delivery days must be greater than or equal to minimum days');
      }
      return true;
    }),
  body('shippingCost.baseRate')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Base rate cannot be negative'),
  body('shippingCost.perKgRate')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Per kg rate cannot be negative'),
  body('isServiceable')
    .optional()
    .isBoolean(),
  body('priority')
    .optional()
    .isInt(),
  validateRequest
];
