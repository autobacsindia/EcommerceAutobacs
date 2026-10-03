/**
 * Staff access validation (express-validator). Pair each chain with `validateRequest`.
 *
 * Shape and bounds only. WHO may invite or remove whom is a capability rule and
 * lives in staffService, which sees the acting user.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { isCommonPassword, COMMON_PASSWORD_MESSAGE } from '../config/commonPasswords.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

export const validateTeamQuery = [
  query('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Unknown team'),
];

export const validateStaffInvite = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Enter a valid email address')
    .isLength({ max: 254 })
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  // The account is created from the invite, and User.phone is required.
  body('phone')
    .trim()
    .matches(/^(\+91[\s-]?)?[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  body('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Unknown team'),
  body('isHead').optional().isBoolean().withMessage('isHead must be true or false').toBoolean(),
];

export const validateInviteIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid invite id'),
];

export const validateMemberIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid member id'),
];

export const validateInviteToken = [
  query('token').isString().isLength({ min: 20, max: 200 }).withMessage('Invalid invite link'),
];

export const validateAcceptInvite = [
  body('token').isString().isLength({ min: 20, max: 200 }).withMessage('Invalid invite link'),
  body('password')
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters')
    .custom((value) => !isCommonPassword(value))
    .withMessage(COMMON_PASSWORD_MESSAGE),
];
