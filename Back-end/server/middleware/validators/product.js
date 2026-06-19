import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';
import { STOCK_VALUES } from '../../utils/stockStatus.js';

const STOCK_MSG = `Stock must be one of: ${STOCK_VALUES.join(', ')}`;

export const validateProduct = [
  body('name')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Product name must be at least 3 characters long'),
  body('description')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Product description must be at least 10 characters long'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Valid price is required'),
  body('categories')
    .isArray({ min: 1 })
    .withMessage('At least one category is required'),
  body('stock')
    .optional()
    .isIn(STOCK_VALUES)
    .withMessage(STOCK_MSG),
  validateRequest
];

export const validateProductUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Product name must be at least 3 characters long'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Product description must be at least 10 characters long'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Valid price is required'),
  body('categories')
    .optional()
    .isArray()
    .withMessage('Categories must be an array'),
  body('categories.*')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Category ID'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('stock')
    .optional()
    .isIn(STOCK_VALUES)
    .withMessage(STOCK_MSG),
  validateRequest
];

export const validateProductIdParam = [
  param('id')
    .customSanitizer((value) => {
      return value && value.startsWith('product-') ? value.replace(/^product-/, '') : value;
    })
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];

export const validateStockUpdate = [
  param('id')
    .customSanitizer((value) => {
      return value.startsWith('product-') ? value.replace(/^product-/, '') : value;
    })
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('stock')
    .isIn(STOCK_VALUES)
    .withMessage(STOCK_MSG),
  validateRequest
];

export const validateTopProductsQuery = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  validateRequest
];

export const validateProductSearch = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500'),
  query('q').optional().trim(),
  query('search').optional().trim(),
  query('sort').optional().trim(),
  query('sortBy').optional().isIn(['createdAt', 'price', 'averageRating', 'totalReviews', 'name']).withMessage('Invalid sort field'),
  query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
  query('brand').optional().trim(),
  query('category').optional().trim(),
  query('year').optional().trim(),
  query('make').optional().trim(),
  query('model').optional().trim(),
  validateRequest
];

export const validateSearchSuggestions = [
  query('q').notEmpty().withMessage('Search query is required').trim(),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20'),
  validateRequest
];

export const validateSearchAnalytics = [
  query('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('End date must be a valid date'),
  validateRequest
];

export const validateSearchHistory = [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  validateRequest
];

export const validateSearchTermParam = [
  param('term').notEmpty().withMessage('Search term is required').trim(),
  validateRequest
];

export const validateProductQuestion = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('question')
    .notEmpty()
    .withMessage('Question is required')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Question must be at least 10 characters long')
    .isLength({ max: 500 })
    .withMessage('Question must be less than 500 characters'),
  body('userName')
    .optional()
    .trim(),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Invalid email address'),
  validateRequest
];

export const validateProductQuestionAnswer = [
  body('answer')
    .notEmpty()
    .withMessage('Answer is required')
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Answer must be less than 2000 characters'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
  validateRequest
];

export const validateProductQuestionQuery = [
  query('pageNumber')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page number must be a positive integer'),
  query('status')
    .optional()
    .isIn(['pending', 'answered', 'rejected'])
    .withMessage('Invalid status'),
  validateRequest
];
