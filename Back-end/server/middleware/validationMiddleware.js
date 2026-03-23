import { body, param, query } from 'express-validator';
import { validateRequest } from './validateRequest.js';
import mongoose from 'mongoose';

// Input validation middleware using express-validator

export const validateIdParam = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid ID format'),
  validateRequest
];

export const validatePinCodesUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Zone ID'),
  body('pinCodes')
    .notEmpty()
    .withMessage('Pin codes are required')
    .isArray({ min: 1 })
    .withMessage('Pin codes must be a non-empty array of strings'),
  body('pinCodes.*')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('All pin codes must be valid 6-digit format'),
  validateRequest
];

export const validateBulkImportPinCodes = [
  body('pinCodeData')
    .notEmpty()
    .withMessage('Pin code data is required')
    .isArray({ min: 1 })
    .withMessage('Pin code data must be a non-empty array'),
  body('pinCodeData.*.pinCode')
    .notEmpty()
    .withMessage('Pin code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('pinCodeData.*.zoneName')
    .notEmpty()
    .withMessage('Zone name is required')
    .trim(),
  validateRequest
];

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

export const validateStockUpdate = [
  param('id')
    .customSanitizer((value) => {
      return value.startsWith('product-') ? value.replace(/^product-/, '') : value;
    })
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('stock')
    .isInt({ min: 0 })
    .withMessage('Valid stock quantity is required (non-negative integer)'),
  validateRequest
];

export const validateOrderStatusUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'failed', 'refunded', 'returned'])
    .withMessage('Invalid order status. Must be one of: pending, confirmed, processing, shipped, delivered, cancelled, failed, refunded, returned'),
  body('reason')
    .optional()
    .trim(),
  body('notes')
    .optional()
    .trim(),
  validateRequest
];

export const validateOrderCancellation = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('reason')
    .optional()
    .trim(),
  body('notes')
    .optional()
    .trim(),
  validateRequest
];

export const validateBulkStatusUpdate = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'failed', 'refunded', 'returned'])
    .withMessage('Invalid order status'),
  validateRequest
];

export const validateBulkDelete = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  validateRequest
];

export const validateTrackingInfo = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('carrierCode')
    .notEmpty()
    .withMessage('Carrier code is required'),
  body('trackingNumber')
    .optional()
    .trim(),
  validateRequest
];

export const validateTrackingEvent = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Tracking status is required'),
  body('location')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  validateRequest
];

export const validatePaymentFailed = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('reason')
    .optional()
    .trim(),
  body('paymentId')
    .optional()
    .trim(),
  body('errorDescription')
    .optional()
    .trim(),
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
    .isInt({ min: 0 })
    .withMessage('Valid stock quantity is required'),
  validateRequest
];

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
  validateRequest
];

export const validateUserIdParam = [
  param('userId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid User ID'),
  validateRequest
];

export const validateVehicleIdParam = [
  param('vehicleId')
    .notEmpty()
    .withMessage('Vehicle ID is required'),
  validateRequest
];

export const validateBrandParam = [
  param('brandName')
    .notEmpty()
    .withMessage('Brand name is required')
    .trim(),
  validateRequest
];

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
    .isInt({ min: 0 })
    .withMessage('Valid stock quantity is required'),
  validateRequest
];

export const validateOrder = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  body('shippingAddress')
    .notEmpty()
    .withMessage('Shipping address is required'),
  body('shippingAddress.fullName')
    .notEmpty()
    .withMessage('Full name is required in shipping address'),
  body('shippingAddress.phone')
    .notEmpty()
    .withMessage('Phone number is required'),
  body('shippingAddress.addressLine1')
    .notEmpty()
    .withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .notEmpty()
    .withMessage('City is required'),
  body('shippingAddress.state')
    .notEmpty()
    .withMessage('State is required'),
  body('shippingAddress.postalCode')
    .notEmpty()
    .withMessage('Postal code is required'),
  // Numeric fields: must be non-negative if provided.
  // discount is intentionally excluded — it is always ignored server-side.
  body('shippingCost')
    .optional()
    .isFloat({ min: 0, max: 10000 })
    .withMessage('shippingCost must be a number between 0 and 10000'),
  body('tax')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('tax must be a non-negative number'),
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
    // If refresh token is in cookie, skip validation of body
    if (req.cookies && req.cookies.refreshToken) {
      return next();
    }
    // Otherwise check body
    next();
  },
  body('refreshToken')
    .if((value, { req }) => !req.cookies?.refreshToken)
    .notEmpty()
    .withMessage('Refresh token is required'),
  validateRequest
];

// Cart Validation
export const validateCartItem = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  validateRequest
];

export const validateCartUpdate = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  validateRequest
];

export const validateCartProductIdParam = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];

export const validateRouteProductId = [
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];

export const validateAnalyticsQuery = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  validateRequest
];

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  validateRequest
];

export const validateTrackingNumberParam = [
  param('trackingNumber')
    .notEmpty()
    .withMessage('Tracking number is required')
    .trim(),
  validateRequest
];

export const validateRefundsQuery = [
  query('status')
    .optional()
    .trim(),
  validateRequest
];

export const validateAdminOrderQuery = [
  query('status')
    .optional()
    .trim(),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  validateRequest
];

export const validateTrackingSimulate = [
  body('scenario')
    .notEmpty()
    .withMessage('Scenario is required')
    .trim(),
  validateRequest
];

export const validateWarehouseQuery = [
  query('status')
    .optional()
    .trim(),
  query('type')
    .optional()
    .trim(),
  query('city')
    .optional()
    .trim(),
  validateRequest
];

export const validateRecentLocations = [
  query('limit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Limit must be a positive integer'),
  validateRequest
];

export const validateTokenQuery = [
  query('token')
    .notEmpty()
    .withMessage('Token is required')
    .trim(),
  validateRequest
];

// Location Validation
export const validateLocationSelect = [
  body('placeId')
    .optional()
    .trim(),
  body('address')
    .optional(), // Can be string or object depending on implementation
  body('coordinates')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) {
        return (
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] >= -180 && value[0] <= 180 &&
          value[1] >= -90 && value[1] <= 90
        );
      }
      if (value && typeof value === 'object') {
        const { latitude, longitude } = value;
        return (
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          longitude >= -180 && longitude <= 180 &&
          latitude >= -90 && latitude <= 90
        );
      }
      return false;
    })
    .withMessage('Coordinates must be [longitude, latitude] or { latitude, longitude }'),
  body('street')
    .optional()
    .trim(),
  validateRequest
];

export const validatePostalCode = [
  body('postalCode')
    .notEmpty()
    .withMessage('Postal code is required')
    .trim()
    .matches(/^\d{6}$/) // Assuming Indian pincodes, adjust if needed
    .withMessage('Invalid postal code format'),
  validateRequest
];

export const validatePostalCodeQuery = [
  query('postalCode')
    .notEmpty()
    .withMessage('Postal code is required')
    .trim(),
  validateRequest
];

export const validateLocationCoordinates = [
  query('latitude')
    .notEmpty()
    .withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  query('longitude')
    .notEmpty()
    .withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  query('maxDistance')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Max distance must be a positive integer'),
  validateRequest
];

// Warehouse Validation
export const validateWarehouse = [
  body('name')
    .notEmpty()
    .withMessage('Warehouse name is required')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Name too long'),
  body('code')
    .notEmpty()
    .withMessage('Warehouse code is required')
    .trim()
    .isUppercase()
    .withMessage('Code must be uppercase')
    .isLength({ max: 20 })
    .withMessage('Code too long'),
  body('type')
    .notEmpty()
    .withMessage('Type is required')
    .isIn(['warehouse', 'store', 'hub'])
    .withMessage('Invalid warehouse type'),
  body('location.address')
    .notEmpty()
    .withMessage('Address is required'),
  body('location.city')
    .notEmpty()
    .withMessage('City is required'),
  body('location.state')
    .notEmpty()
    .withMessage('State is required'),
  body('location.postalCode')
    .notEmpty()
    .withMessage('Postal code is required'),
  body('location.coordinates.coordinates')
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be [longitude, latitude]'),
  validateRequest
];

export const validateWarehouseUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }),
  body('code')
    .optional()
    .trim()
    .isUppercase()
    .isLength({ max: 20 }),
  body('type')
    .optional()
    .isIn(['warehouse', 'store', 'hub']),
  validateRequest
];

export const validateWarehouseInventoryQuery = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  query('page')
    .optional()
    .isInt({ min: 1 }),
  query('limit')
    .optional()
    .isInt({ min: 1 }),
  query('productId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  query('lowStock')
    .optional()
    .isBoolean(),
  validateRequest
];

export const validateWarehouseStockUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Warehouse ID'),
  param('productId')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  body('operation')
    .optional()
    .isIn(['add', 'subtract', 'set'])
    .withMessage('Invalid operation'),
  validateRequest
];

export const validateWarehouseSelection = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order items must be a non-empty array'),
  body('deliveryAddress')
    .notEmpty()
    .withMessage('Delivery address is required'),
  validateRequest
];

// Category Validation
export const validateCategory = [
  body('name')
    .notEmpty()
    .withMessage('Category name is required')
    .trim(),
  body('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('description')
    .optional()
    .trim(),
  body('parent')
    .optional()
    .custom((value) => !value || mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Parent Category ID'),
  body('order')
    .optional()
    .isInt()
    .withMessage('Order must be an integer'),
  validateRequest
];

export const validateCategoryUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Category ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Category name cannot be empty'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('parent')
    .optional()
    .custom((value) => !value || mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Parent Category ID'),
  body('order')
    .optional()
    .isInt()
    .withMessage('Order must be an integer'),
  validateRequest
];

export const validateSlugParam = [
  param('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim(),
  validateRequest
];

// Wishlist Validation
export const validateWishlist = [
  body('name')
    .notEmpty()
    .withMessage('Wishlist name is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Wishlist name must be between 1 and 50 characters')
    .trim(),
  body('description')
    .optional({ nullable: true })
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters')
    .trim(),
  body('privacy')
    .optional({ nullable: true })
    .isIn(['private', 'public', 'shared'])
    .withMessage('Privacy must be either private, public, or shared'),
  validateRequest
];

export const validateWishlistItem = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Product ID must be a valid MongoDB ObjectId'),
  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 200 })
    .withMessage('Notes must be less than 200 characters')
    .trim(),
  validateRequest
];

export const validateSharing = [
  body('isPublic')
    .optional({ nullable: true })
    .isBoolean()
    .withMessage('isPublic must be a boolean value'),
  body('userIds')
    .optional({ nullable: true })
    .isArray()
    .withMessage('userIds must be an array'),
  body('role')
    .optional({ nullable: true })
    .isIn(['viewer', 'editor'])
    .withMessage('Role must be either viewer or editor'),
  validateRequest
];

// Brand Validation
export const validateBrand = [
  body('name')
    .notEmpty()
    .withMessage('Brand name is required')
    .trim(),
  body('logo')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  validateRequest
];

export const validateBrandUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Brand ID'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Brand name cannot be empty'),
  body('logo')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  validateRequest
];

export const validateBrandProductMap = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Brand ID'),
  body('productIds')
    .isArray({ min: 1 })
    .withMessage('Product IDs array is required and must not be empty'),
  body('productIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID in list'),
  validateRequest
];

// Vehicle Validation
export const validateVehicle = [
  body('make')
    .notEmpty()
    .withMessage('Make is required')
    .trim(),
  body('model')
    .notEmpty()
    .withMessage('Model is required')
    .trim(),
  body('year')
    .notEmpty()
    .withMessage('Year is required')
    .trim(),
  body('slug')
    .notEmpty()
    .withMessage('Slug is required')
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('variant')
    .optional()
    .trim(),
  body('image')
    .optional()
    .trim(),
  validateRequest
];

export const validateVehicleUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Vehicle ID'),
  body('make')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Make cannot be empty'),
  body('model')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Model cannot be empty'),
  body('year')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Year cannot be empty'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  validateRequest
];

export const validateVehicleProductMap = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Vehicle ID'),
  body('productIds')
    .isArray({ min: 1 })
    .withMessage('Product IDs array is required and must not be empty'),
  body('productIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID in list'),
  validateRequest
];

export const validateMakeModelParam = [
  param('make')
    .notEmpty()
    .withMessage('Make is required')
    .trim(),
  param('model')
    .notEmpty()
    .withMessage('Model is required')
    .trim(),
  validateRequest
];

// Return/Refund Validation
export const validateReturnRequest = [
  body('orderId')
    .notEmpty()
    .withMessage('Valid Order ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('type')
    .notEmpty()
    .withMessage('Return type is required')
    .isIn(['return', 'exchange'])
    .withMessage('Invalid return type'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items must be an array with at least one item'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('Valid Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('items.*.reason')
    .isIn(['defective', 'wrong_item', 'other'])
    .withMessage('Invalid reason'),
  body('items.*.condition')
    .optional()
    .isIn(['unopened', 'opened', 'damaged'])
    .withMessage('Invalid condition'),
  body('refundMethod')
    .optional()
    .isIn(['store_credit', 'original_payment'])
    .withMessage('Invalid refund method'),
  body('comments')
    .optional()
    .trim(),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  validateRequest
];

export const validateOrderReturn = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item must be selected for return'),
  body('items.*.productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('reason')
    .notEmpty()
    .withMessage('Return reason is required')
    .isIn(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'])
    .withMessage('Invalid return reason'),
  body('description')
    .optional()
    .trim(),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  validateRequest
];

export const validateReturnStatusUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Return Request ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'approved', 'rejected', 'completed', 'cancelled'])
    .withMessage('Invalid return status'),
  body('adminNotes')
    .optional()
    .trim(),
  body('rejectionReason')
    .if(body('status').equals('rejected'))
    .notEmpty()
    .withMessage('Rejection reason is required when rejecting a request')
    .trim(),
  validateRequest
];

// Profile Validation
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

// Contact Validation
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

// Review Validation
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

export const validateTopProductsQuery = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
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

export const validateWishlistImport = [
  body('wishlistData')
    .notEmpty()
    .withMessage('Wishlist data is required'),
  body('wishlistData.name')
    .notEmpty()
    .withMessage('Wishlist name is required')
    .trim(),
  body('wishlistData.description')
    .optional()
    .trim(),
  body('wishlistData.privacy')
    .optional()
    .isIn(['private', 'public', 'shared'])
    .withMessage('Privacy must be either private, public, or shared'),
  body('wishlistData.items')
    .optional()
    .isArray()
    .withMessage('Items must be an array'),
  body('wishlistData.items.*.productId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Product ID'),
  validateRequest
];

export const validatePinCodeParam = [
  param('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  validateRequest
];

export const validateServiceabilityCheck = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  validateRequest
];

export const validateDeliveryEstimate = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('orderDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid order date format'),
  validateRequest
];

export const validateShippingCost = [
  body('pinCode')
    .notEmpty()
    .withMessage('PIN code is required')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Invalid PIN code format'),
  body('weightKg')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be a positive number'),
  validateRequest
];

export const validateDeliveryZone = [
  body('name')
    .notEmpty()
    .withMessage('Zone name is required')
    .trim(),
  body('type')
    .notEmpty()
    .withMessage('Zone type is required')
    .isIn(['metro', 'tier1', 'tier2', 'remote'])
    .withMessage('Invalid zone type'),
  body('pinCodes')
    .optional()
    .isArray()
    .withMessage('Pin codes must be an array of strings'),
  body('cities')
    .optional()
    .isArray()
    .withMessage('Cities must be an array of strings'),
  body('states')
    .optional()
    .isArray()
    .withMessage('States must be an array of strings'),
  body('deliveryTime.minDays')
    .notEmpty()
    .withMessage('Minimum delivery days is required')
    .isInt({ min: 1 })
    .withMessage('Minimum delivery days must be at least 1'),
  body('deliveryTime.maxDays')
    .notEmpty()
    .withMessage('Maximum delivery days is required')
    .isInt({ min: 1 })
    .withMessage('Maximum delivery days must be at least 1')
    .custom((value, { req }) => {
      if (req.body.deliveryTime && value < req.body.deliveryTime.minDays) {
        throw new Error('Maximum delivery days must be greater than or equal to minimum days');
      }
      return true;
    }),
  body('shippingCost.baseRate')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Base rate cannot be negative'),
  body('shippingCost.perKgRate')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Per kg rate cannot be negative'),
  body('isServiceable')
    .optional()
    .isBoolean(),
  body('priority')
    .optional()
    .isInt(),
  validateRequest
];

export const validateBrandQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  validateRequest
];

export const validateVehicleQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  query('make').optional().trim(),
  query('model').optional().trim(),
  query('year').optional().trim(),
  validateRequest
];

// Product Search Validation
export const validateProductSearch = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('q').optional().trim(),
  query('sort').optional().trim(),
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

// Product Question Validation
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
    .withMessage('Question must be at least 10 characters long'),
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
    .trim(),
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

// Payment Method Validation
export const validatePaymentMethod = [
  body('paymentMethod').notEmpty().withMessage('Payment method is required'),
  body('paymentGateway').notEmpty().withMessage('Payment gateway is required'),
  validateRequest
];

// Razorpay Validation
export const validateRazorpayOrder = [
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('currency').optional().isString().withMessage('Currency must be a string'),
  body('receipt').optional().isString().withMessage('Receipt must be a string'),
  validateRequest
];

export const validateRazorpayVerification = [
  body('razorpay_order_id').notEmpty().withMessage('Razorpay order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Razorpay payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Razorpay signature is required'),
  body('orderId').optional().isString().withMessage('Order ID must be a string'),
  validateRequest
];
