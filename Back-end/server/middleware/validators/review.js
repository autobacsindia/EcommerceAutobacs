import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

export const validateReviewUpdate = [
  param('reviewId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Review ID'),
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

export const validateReviewIdParam = [
  param('reviewId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Review ID'),
  validateRequest
];

export const validateReviewQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'rating', 'helpfulCount'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Invalid sort order'),
  query('minRating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Min rating must be between 1 and 5'),
  query('maxRating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Max rating must be between 1 and 5'),
  query('hasImages')
    .optional()
    .isBoolean()
    .withMessage('hasImages must be a boolean'),
  validateRequest
];

export const validateAdminReviewQuery = [
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
    .isIn(['approved', 'pending', 'rejected', 'all'])
    .withMessage('Invalid status'),
  query('productId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  query('userId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid User ID'),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'rating', 'helpfulCount'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Invalid sort order'),
  validateRequest
];

export const validateReviewSubmission = [
  param('productId').custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid Product ID'),
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
