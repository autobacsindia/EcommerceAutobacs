import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateUserUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid User ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Name is required'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  body('role')
    .optional()
    .isIn(['user', 'admin'])
    .withMessage('Invalid role'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('isSalesRep')
    .optional()
    .isBoolean()
    .withMessage('isSalesRep must be a boolean'),
  body('salesTarget')
    .optional()
    .isInt({ min: 0 })
    .withMessage('salesTarget must be a non-negative integer'),
  validateRequest
];

export const validateUserIdParam = [
  param('userId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid User ID'),
  validateRequest
];

export const validateProfileUpdate = [
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('addresses').optional().isArray().withMessage('Addresses must be an array'),
  body('addresses.*.fullName').optional().notEmpty().withMessage('Full name is required for address'),
  body('addresses.*.phone').optional().notEmpty().withMessage('Phone is required for address'),
  body('addresses.*.addressLine1').optional().notEmpty().withMessage('Address line 1 is required'),
  body('addresses.*.city').optional().notEmpty().withMessage('City is required'),
  body('addresses.*.state').optional().notEmpty().withMessage('State is required'),
  body('addresses.*.postalCode').optional().notEmpty().withMessage('Postal code is required'),
  validateRequest
];
