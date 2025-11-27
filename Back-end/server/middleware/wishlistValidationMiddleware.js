import { body, validationResult } from 'express-validator';

// Validation rules for wishlist creation/update
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

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Create a more descriptive error message
      const errorMessages = errors.array().map(error => error.msg || 'Validation error');
      let combinedMessage = errorMessages.join(', ');
      
      // If all errors are generic, provide a more descriptive message
      if (errorMessages.every(msg => msg === 'Validation error')) {
        combinedMessage = 'Validation failed. Please check your input and try again.';
      }
      
      return res.status(400).json({
        success: false,
        message: combinedMessage,
        errors: errors.array()
      });
    }
    next();
  }
];

// Validation rules for wishlist items
export const validateWishlistItem = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .isMongoId()
    .withMessage('Product ID must be a valid MongoDB ObjectId'),

  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 200 })
    .withMessage('Notes must be less than 200 characters')
    .trim(),

  (req, res, next) => {
    console.log('Validating wishlist item request:', {
      body: req.body,
      params: req.params
    });
    
    const errors = validationResult(req);
    console.log('Validation errors:', errors.array());
    
    if (!errors.isEmpty()) {
      // Log validation errors for debugging
      console.log('Wishlist item validation errors:', errors.array());
      console.log('Request body:', req.body);
      console.log('Request params:', req.params);
      
      // Create a more descriptive error message
      const errorMessages = errors.array().map(error => {
        console.log('Individual error:', error);
        return error.msg || 'Validation error';
      });
      let combinedMessage = errorMessages.join(', ');
      
      // If all errors are generic, provide a more descriptive message
      if (errorMessages.every(msg => msg === 'Validation error')) {
        combinedMessage = 'Validation failed. Please check your input and try again.';
      }
      
      console.log('Sending validation error response:', {
        status: 400,
        message: combinedMessage,
        errors: errors.array()
      });
      
      return res.status(400).json({
        success: false,
        message: combinedMessage,
        errors: errors.array()
      });
    }
    
    console.log('Validation passed, proceeding to next middleware');
    next();
  }
];

// Validation rules for sharing
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

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Create a more descriptive error message
      const errorMessages = errors.array().map(error => error.msg || 'Validation error');
      let combinedMessage = errorMessages.join(', ');
      
      // If all errors are generic, provide a more descriptive message
      if (errorMessages.every(msg => msg === 'Validation error')) {
        combinedMessage = 'Validation failed. Please check your input and try again.';
      }
      
      return res.status(400).json({
        success: false,
        message: combinedMessage,
        errors: errors.array()
      });
    }
    next();
  }
];