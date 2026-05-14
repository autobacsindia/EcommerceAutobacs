import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateContactSubmission = [
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('email').isEmail().withMessage('Please include a valid email').normalizeEmail(),
  body('subject').notEmpty().withMessage('Subject is required').trim(),
  body('message').notEmpty().withMessage('Message is required').trim(),
  validateRequest
];

export const validateContactReply = [
  param('id').custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid Contact ID'),
  body('message').notEmpty().withMessage('Reply message is required').trim(),
  validateRequest
];

export const validateContactStatusUpdate = [
  param('id').custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid Contact ID'),
  body('status').optional().isIn(['new', 'read', 'replied', 'closed']).withMessage('Invalid status'),
  body('adminNotes').optional().trim(),
  validateRequest
];

export const validateContactQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['new', 'read', 'replied', 'closed'])
    .withMessage('Invalid status filter'),
  validateRequest
];
