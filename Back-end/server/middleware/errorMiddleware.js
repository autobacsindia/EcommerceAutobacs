// Global error handling middleware for Express
import AppError from '../utils/AppError.js';

export const errorHandler = (err, req, res, next) => {
  // Only log detailed errors in development or if it's a 500
  if (process.env.NODE_ENV === 'development' || !err.statusCode || err.statusCode === 500) {
    console.error('Error:', err);
  }

  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    error = new AppError('Validation Error', 400);
    error.errors = errors;
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = new AppError(`${field} already exists`, 400);
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    error = new AppError('Invalid ID format', 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401);
  }

  // Send response
  res.status(error.statusCode).json({
    success: false,
    status: error.status || 'error',
    message: error.message || 'Internal Server Error',
    errors: error.errors,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Not found middleware
export const notFound = (req, res, next) => {
  const error = new AppError(`Route not found - ${req.originalUrl}`, 404);
  next(error);
};

// Async handler wrapper to avoid try-catch in every route
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
