/**
 * Input Validation Schemas
 * 
 * Centralized validation schemas for all API endpoints.
 * Uses express-validator with comprehensive security checks:
 * - String length limits (prevent buffer overflow/DoS)
 * - Type validation
 * - Range validation
 * - Format validation
 * - XSS protection via sanitization
 * 
 * Organization:
 * - product.validator.js
 * - user.validator.js
 * - order.validator.js
 * - auth.validator.js
 */

import { body, param, query, header } from 'express-validator';
import mongoose from 'mongoose';

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_LENGTHS = {
  // Product fields
  productName: 200,
  productDescription: 5000,
  productSKU: 100,
  productBrand: 100,
  productTag: 50,
  productSlug: 200,
  
  // User fields
  userName: 100,
  userEmail: 255,
  userPassword: 128,
  userPhone: 20,
  userAddress: 500,
  
  // Order fields
  orderNote: 1000,
  orderTrackingNumber: 100,
  
  // Review fields
  reviewTitle: 100,
  reviewComment: 1000,
  
  // Generic
  genericString: 500,
  url: 2048
};

const MAX_ARRAY_LENGTHS = {
  productTags: 10,
  productImages: 10,
  productCategories: 5,
  orderItems: 50,
  reviewImages: 5
};

// ── Product Validation ──────────────────────────────────────────────────────

export const validateProductCreate = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: MAX_LENGTHS.productName })
    .withMessage(`Product name must be less than ${MAX_LENGTHS.productName} characters`)
    .escape(), // XSS protection
  
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.productDescription })
    .withMessage(`Description must be less than ${MAX_LENGTHS.productDescription} characters`)
    .escape(), // XSS protection
  
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  
  body('brand')
    .trim()
    .notEmpty()
    .withMessage('Brand is required')
    .isLength({ max: MAX_LENGTHS.productBrand })
    .withMessage(`Brand must be less than ${MAX_LENGTHS.productBrand} characters`)
    .escape(),
  
  body('sku')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.productSKU })
    .withMessage(`SKU must be less than ${MAX_LENGTHS.productSKU} characters`)
    .escape(),
  
  body('slug')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.productSlug })
    .withMessage(`Slug must be less than ${MAX_LENGTHS.productSlug} characters`)
    .isSlug()
    .withMessage('Invalid slug format')
    .escape(),
  
  body('tags')
    .optional({ nullable: true })
    .isArray({ max: MAX_ARRAY_LENGTHS.productTags })
    .withMessage(`Maximum ${MAX_ARRAY_LENGTHS.productTags} tags allowed`),
  
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: MAX_LENGTHS.productTag })
    .withMessage(`Each tag must be less than ${MAX_LENGTHS.productTag} characters`)
    .escape(),
  
  body('categories')
    .optional({ nullable: true })
    .isArray({ max: MAX_ARRAY_LENGTHS.productCategories })
    .withMessage(`Maximum ${MAX_ARRAY_LENGTHS.productCategories} categories allowed`),
  
  body('categories.*')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid category ID format'),
  
  body('stock')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  
  body('images')
    .optional({ nullable: true })
    .isArray({ max: MAX_ARRAY_LENGTHS.productImages })
    .withMessage(`Maximum ${MAX_ARRAY_LENGTHS.productImages} images allowed`),
  
  body('images.*.url')
    .optional()
    .isURL()
    .withMessage('Invalid image URL'),
  
  body('images.*.alt')
    .optional()
    .trim()
    .isLength({ max: MAX_LENGTHS.genericString })
    .withMessage(`Image alt text must be less than ${MAX_LENGTHS.genericString} characters`)
    .escape()
];

export const validateProductUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid product ID'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ max: MAX_LENGTHS.productName })
    .withMessage(`Product name must be less than ${MAX_LENGTHS.productName} characters`)
    .escape(),
  
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.productDescription })
    .withMessage(`Description must be less than ${MAX_LENGTHS.productDescription} characters`)
    .escape(),
  
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  
  body('stock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  
  // Strip unknown fields
  body('*').custom((value, { req }) => {
    const allowedFields = ['name', 'description', 'price', 'stock', 'brand', 'tags', 'categories', 'images', 'isFeatured', 'isFastMoving'];
    const unknownFields = Object.keys(req.body).filter(field => !allowedFields.includes(field));
    
    if (unknownFields.length > 0) {
      // Log but don't reject (soft validation)
      console.warn(`[Validation] Unknown fields ignored:`, unknownFields);
    }
    return true;
  })
];

export const validateProductSearch = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('search')
    .optional()
    .trim()
    .isLength({ max: MAX_LENGTHS.genericString })
    .withMessage(`Search query must be less than ${MAX_LENGTHS.genericString} characters`)
    .escape(),
  
  query('brand')
    .optional()
    .trim()
    .isLength({ max: MAX_LENGTHS.productBrand })
    .withMessage(`Brand filter must be less than ${MAX_LENGTHS.productBrand} characters`)
    .escape(),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a positive number'),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a positive number')
    .custom((value, { req }) => {
      if (req.query.minPrice && parseFloat(value) < parseFloat(req.query.minPrice)) {
        throw new Error('Maximum price must be greater than minimum price');
      }
      return true;
    })
];

// ── User Validation ─────────────────────────────────────────────────────────

export const validateUserRegistration = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: MAX_LENGTHS.userName })
    .withMessage(`Name must be less than ${MAX_LENGTHS.userName} characters`)
    .escape(),
  
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: MAX_LENGTHS.userEmail })
    .withMessage(`Email must be less than ${MAX_LENGTHS.userEmail} characters`),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8, max: MAX_LENGTHS.userPassword })
    .withMessage(`Password must be between 8 and ${MAX_LENGTHS.userPassword} characters`)
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  
  body('phone')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.userPhone })
    .withMessage(`Phone must be less than ${MAX_LENGTHS.userPhone} characters`)
    .matches(/^[\d\s\-\+\(\)]+$/)
    .withMessage('Invalid phone number format')
];

export const validateUserLogin = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ max: MAX_LENGTHS.userPassword })
    .withMessage(`Password must be less than ${MAX_LENGTHS.userPassword} characters`)
];

// ── Order Validation ────────────────────────────────────────────────────────

export const validateOrderCreate = [
  body('items')
    .isArray({ min: 1, max: MAX_ARRAY_LENGTHS.orderItems })
    .withMessage(`Order must have between 1 and ${MAX_ARRAY_LENGTHS.orderItems} items`),
  
  body('items.*.product')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid product ID'),
  
  body('items.*.quantity')
    .isInt({ min: 1, max: 100 })
    .withMessage('Quantity must be between 1 and 100'),
  
  body('shippingAddress.name')
    .trim()
    .notEmpty()
    .withMessage('Recipient name is required')
    .isLength({ max: MAX_LENGTHS.userName })
    .withMessage(`Name must be less than ${MAX_LENGTHS.userName} characters`)
    .escape(),
  
  body('shippingAddress.address')
    .trim()
    .notEmpty()
    .withMessage('Address is required')
    .isLength({ max: MAX_LENGTHS.userAddress })
    .withMessage(`Address must be less than ${MAX_LENGTHS.userAddress} characters`)
    .escape(),
  
  body('shippingAddress.phone')
    .trim()
    .notEmpty()
    .withMessage('Phone is required')
    .isLength({ max: MAX_LENGTHS.userPhone })
    .withMessage(`Phone must be less than ${MAX_LENGTHS.userPhone} characters`),
  
  body('shippingAddress.postalCode')
    .trim()
    .notEmpty()
    .withMessage('Postal code is required')
    .matches(/^\d{6}$/)
    .withMessage('Invalid postal code format (must be 6 digits)'),
  
  body('notes')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.orderNote })
    .withMessage(`Notes must be less than ${MAX_LENGTHS.orderNote} characters`)
    .escape()
];

// ── Review Validation ───────────────────────────────────────────────────────

export const validateReviewCreate = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid product ID'),
  
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  
  body('title')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: MAX_LENGTHS.reviewTitle })
    .withMessage(`Title must be less than ${MAX_LENGTHS.reviewTitle} characters`)
    .escape(),
  
  body('comment')
    .trim()
    .isLength({ min: 10, max: MAX_LENGTHS.reviewComment })
    .withMessage(`Comment must be between 10 and ${MAX_LENGTHS.reviewComment} characters`)
    .escape(),
  
  body('images')
    .optional({ nullable: true })
    .isArray({ max: MAX_ARRAY_LENGTHS.reviewImages })
    .withMessage(`Maximum ${MAX_ARRAY_LENGTHS.reviewImages} images allowed`),
  
  body('images.*.url')
    .optional()
    .isURL()
    .withMessage('Invalid image URL')
];

// ── Content-Type Enforcement ────────────────────────────────────────────────

export const enforceJsonContentType = (req, res, next) => {
  // Only enforce for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!req.is('application/json')) {
      return res.status(415).json({
        success: false,
        error: 'Unsupported Media Type',
        message: 'Content-Type must be application/json'
      });
    }
  }
  next();
};

// ── Validation Error Handler ────────────────────────────────────────────────

import { validationResult } from 'express-validator';

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg
      }))
    });
  }
  
  next();
};
