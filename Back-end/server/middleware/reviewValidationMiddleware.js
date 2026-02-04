import { body } from 'express-validator';
import { validateRequest } from './validateRequest.js';

// Review validation middleware using express-validator
export const validateReview = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),
  body('title')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Review title must be less than 100 characters'),
  body('comment')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Review comment must be at least 10 characters long')
    .isLength({ max: 1000 })
    .withMessage('Review comment must be less than 1000 characters'),
  body('images')
    .optional({ nullable: true })
    .isArray({ max: 5 })
    .withMessage('Maximum 5 images allowed per review'),
  body('images.*.url')
    .optional({ nullable: true })
    .isURL()
    .withMessage('Invalid image URL format'),
  validateRequest
];
