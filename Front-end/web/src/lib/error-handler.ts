/**
 * Service Error Handler
 * 
 * Provides consistent error handling across all services.
 * All services should use this to transform errors into standardized shapes.
 */

import { ApiError, ErrorCategory, type ServiceError } from '@/lib/api-types';

/**
 * Standard error codes used across the application
 */
export const ErrorCodes = {
  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  
  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Resource
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  
  // Rate Limiting
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  
  // Business Logic
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  ORDER_CANNOT_BE_CANCELLED: 'ORDER_CANNOT_BE_CANCELLED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION'
} as const;

/**
 * Transform any error into a standardized ServiceError shape
 */
export function handleError(error: unknown): ServiceError {
  // Already an ApiError
  if (error instanceof ApiError) {
    return error.toServiceError();
  }
  
  // Standard Error
  if (error instanceof Error) {
    return {
      message: error.message,
      status: 0,
      category: ErrorCategory.NETWORK
    };
  }
  
  // String error
  if (typeof error === 'string') {
    return {
      message: error,
      status: 0,
      category: ErrorCategory.CLIENT
    };
  }
  
  // Unknown error
  return {
    message: 'An unexpected error occurred',
    status: 0,
    category: ErrorCategory.SERVER
  };
}

/**
 * Check if an error is a specific error code
 */
export function isErrorCode(error: unknown, code: string): boolean {
  if (error instanceof ApiError) {
    return error.code === code;
  }
  return false;
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 429;
  }
  return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}

/**
 * Check if error is a validation error
 */
export function isValidationError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 400 && error.code === ErrorCodes.VALIDATION_FAILED;
  }
  return false;
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  const serviceError = handleError(error);
  
  // Map error codes to user-friendly messages
  const friendlyMessages: Record<string, string> = {
    [ErrorCodes.UNAUTHORIZED]: 'Please log in to continue',
    [ErrorCodes.TOKEN_EXPIRED]: 'Your session has expired. Please log in again',
    [ErrorCodes.INVALID_CREDENTIALS]: 'Invalid email or password',
    [ErrorCodes.VALIDATION_FAILED]: 'Please check your input and try again',
    [ErrorCodes.NOT_FOUND]: 'The requested resource was not found',
    [ErrorCodes.RATE_LIMITED]: 'Too many requests. Please wait a moment and try again',
    [ErrorCodes.INSUFFICIENT_STOCK]: 'Some items are out of stock. Please update your cart',
    [ErrorCodes.ORDER_CANNOT_BE_CANCELLED]: 'This order cannot be cancelled at this time',
    [ErrorCodes.TIMEOUT]: 'The request took too long. Please try again',
    [ErrorCodes.SERVICE_UNAVAILABLE]: 'Service is temporarily unavailable. Please try again later'
  };
  
  return serviceError.code && friendlyMessages[serviceError.code]
    ? friendlyMessages[serviceError.code]
    : serviceError.message || 'An unexpected error occurred';
}

/**
 * Log error for debugging (respects production/test environment)
 */
export function logError(error: unknown, context?: string): void {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return;
  }
  
  const serviceError = handleError(error);
  
  console.error(
    `[ERROR] ${context || 'Service Error'}`,
    {
      message: serviceError.message,
      code: serviceError.code,
      status: serviceError.status,
      category: serviceError.category
    }
  );
}
