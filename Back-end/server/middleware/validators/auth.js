import { body } from 'express-validator';
import { STAFF_USERNAME_PATTERN } from '../../config/staff.js';
import { validateRequest } from '../validateRequest.js';
import { isCommonPassword, COMMON_PASSWORD_MESSAGE } from '../../config/commonPasswords.js';

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
    .withMessage('Password must be between 8 and 72 characters')
    .custom((value) => !isCommonPassword(value))
    .withMessage(COMMON_PASSWORD_MESSAGE),
  validateRequest
];

export const validateLogin = [
  // `email` carries an email OR a company-account username (config/staff.js) —
  // the field keeps its name so existing clients need no change. An email is
  // normalised as before; a username is lower-cased and must fit the pattern.
  body('email')
    .notEmpty()
    .withMessage('Email or username is required')
    .isString()
    .isLength({ max: 254 })
    .withMessage('Email must not exceed 254 characters'),
  body('email')
    .if(body('email').contains('@'))
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  body('email')
    .if(body('email').not().contains('@'))
    .trim()
    .toLowerCase()
    .matches(STAFF_USERNAME_PATTERN)
    .withMessage('Enter a valid email or username'),
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
    .withMessage('Password must be between 8 and 72 characters')
    .custom((value) => !isCommonPassword(value))
    .withMessage(COMMON_PASSWORD_MESSAGE),
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
