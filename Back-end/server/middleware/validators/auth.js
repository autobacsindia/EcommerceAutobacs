import { body } from 'express-validator';
import { validateRequest } from '../validateRequest.js';

export const validateRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'\-\.]+$/)
    .withMessage('Name may only contain letters, spaces, hyphens, apostrophes, and periods'),
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .isLength({ max: 254 })
    .withMessage('Email must not exceed 254 characters')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters'),
  validateRequest
];

export const validateLogin = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Valid email is required')
    .isLength({ max: 254 })
    .withMessage('Email must not exceed 254 characters')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ max: 72 })
    .withMessage('Password must not exceed 72 characters'),
  validateRequest
];

export const validateForgotPassword = [
  body('email')
    .notEmpty()
    .withMessage('Email address is required')
    .isEmail()
    .withMessage('Valid email address required')
    .normalizeEmail(),
  validateRequest
];

export const validateResetPassword = [
  body('token')
    .notEmpty()
    .withMessage('Token is required'),
  body('password')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters'),
  validateRequest
];

export const validateRefreshTokenInput = [
  (req, res, next) => {
    if (req.cookies && req.cookies.refreshToken) {
      return next();
    }
    next();
  },
  body('refreshToken')
    .if((value, { req }) => !req.cookies?.refreshToken)
    .notEmpty()
    .withMessage('Refresh token is required'),
  validateRequest
];

export const validateResendVerification = [
  body('email')
    .custom((value, { req }) => {
      if (!req.user && !value) {
        throw new Error('Email address is required');
      }
      return true;
    })
    .optional()
    .isEmail()
    .withMessage('Please include a valid email')
    .normalizeEmail(),
  validateRequest
];
