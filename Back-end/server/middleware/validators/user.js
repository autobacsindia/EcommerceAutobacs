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

