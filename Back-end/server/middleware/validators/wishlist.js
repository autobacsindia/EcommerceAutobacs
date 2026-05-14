import { body, param } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';

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
