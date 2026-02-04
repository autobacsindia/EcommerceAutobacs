import { validationResult } from 'express-validator';

/**
 * Middleware to handle validation results from express-validator
 * If validation fails, it responds with a 400 error and the list of errors
 */
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Format errors for easier consumption
    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      value: err.value
    }));

    // Create a combined message for simple display
    const errorMessages = [...new Set(formattedErrors.map(e => e.message))];
    const message = errorMessages.join('. ');

    return res.status(400).json({
      success: false,
      message: message || 'Validation failed',
      errors: formattedErrors
    });
  }
  next();
};
