// Global error handling middleware for Express
// SECURITY: Never expose stack traces to clients (secure by default)
import AppError from '../utils/AppError.js';
import crypto from 'crypto';

/**
 * Safe error messages whitelist (prevent accidental data leakage)
 * Only these exact messages are shown to users, even for operational errors
 */
const SAFE_ERROR_MESSAGES = new Set([
  // Auth errors
  'Invalid email or password',
  'Token expired',
  'Invalid token',
  'Not authorized, token failed',
  'Not authorized, no token provided',
  
  // Validation errors
  'Validation Error',
  'Invalid email format',
  'Password must be at least 6 characters',
  
  // Resource errors
  'Product not found',
  'Product out of stock',
  'Cart not found',
  'Order not found',
  'User not found',
  'Category not found',
  'Vehicle not found',
  
  // Business logic errors
  'Invalid coupon code',
  'Coupon expired',
  'Coupon already used',
  'Minimum order amount not met',
  'Maximum quantity exceeded',
  
  // Payment errors
  'Payment failed',
  'Payment verification failed',
  'Refund failed',
  
  // Rate limiting
  'Too many requests, please try again later',
  
  // File errors
  'File upload failed',
  'Invalid file type',
  'File too large'
]);

/**
 * Deep sanitize object to redact sensitive fields at any nesting level
 * Handles circular references and value pattern detection
 */
function deepSanitize(obj, level = 0, maxLevel = 5, seen = new WeakSet()) {
  // Prevent infinite recursion
  if (level > maxLevel) return '[MAX_DEPTH_REached]';
  
  if (!obj || typeof obj !== 'object') return obj;
  
  // CRITICAL: Detect circular references
  if (seen.has(obj)) return '[CIRCULAR]';
  seen.add(obj);
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitize(item, level + 1, maxLevel, seen));
  }
  
  const sensitiveKeys = [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'apiKey',
    'api_secret',
    'cardNumber',
    'card_number',
    'cvv',
    'cvc',
    'razorpay_signature',
    'signature',
    'ssn',
    'pan',
    'accountNumber'
  ];
  
  // Value pattern detection (catches obfuscated field names)
  const looksLikeCardNumber = (value) => 
    typeof value === 'string' && /^\d{13,19}$/.test(value.replace(/\s/g, ''));
  
  const looksLikeToken = (value) =>
    typeof value === 'string' && 
    (value.startsWith('eyJ') || // JWT
     value.startsWith('sk_') ||  // Stripe secret key
     value.startsWith('rk_') ||  // Razorpay key
     (value.length > 50 && /^[a-zA-Z0-9_-]+$/.test(value))); // Long alphanumeric token
  
  return Object.keys(obj).reduce((acc, key) => {
    const lowerKey = key.toLowerCase();
    const value = obj[key];
    
    // Check if key matches sensitive pattern
    const isSensitiveKey = sensitiveKeys.some(sensitive => 
      lowerKey.includes(sensitive.toLowerCase())
    );
    
    // Check if value looks like sensitive data
    const isSensitiveValue = looksLikeCardNumber(value) || looksLikeToken(value);
    
    if (isSensitiveKey || isSensitiveValue) {
      acc[key] = '[REDACTED]';
    } else {
      acc[key] = deepSanitize(value, level + 1, maxLevel, seen);
    }
    
    return acc;
  }, {});
}

/**
 * Get safe error message (whitelist-based, not trust-based)
 */
function getSafeMessage(err, isOperational) {
  // Only show exact whitelisted messages
  if (isOperational && SAFE_ERROR_MESSAGES.has(err.message)) {
    return err.message;
  }
  
  // All other errors → generic message (including operational with dynamic messages)
  return 'Something went wrong. Please try again later.';
}

/**
 * Truncate log value to prevent massive payloads
 */
function truncateLog(value, maxLength = 2000) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length <= maxLength) return value;
  return str.slice(0, maxLength) + '...[TRUNCATED]';
}

export const errorHandler = (err, req, res, next) => {
  // Generate unique error ID for support tracking
  const errorId = crypto.randomUUID();
  
  const statusCode = err.statusCode || err.status?.code || 500;
  const isOperational = err.isOperational === true;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const isServerError = statusCode >= 500;

  // Sanitize and truncate body for logging (deep sanitization)
  const sanitizedBody = deepSanitize(req.body);
  const safeBodyForLog = truncateLog(sanitizedBody);

  // CRITICAL: Truncate stack trace (prevent leaking secrets in deep stacks)
  const safeStack = err.stack 
    ? err.stack.split('\n').slice(0, 10).join('\n') + '\n  ...[TRUNCATED]'
    : 'No stack trace available';

  // CRITICAL: Always log full error internally (never to client)
  // Use structured logging format (compatible with pino/winston migration)
  console.error(JSON.stringify({
    level: 'error',
    errorId,
    requestId: req.requestId || 'unknown',
    timestamp: new Date().toISOString(),
    message: err.message,
    stack: safeStack, // Truncated to 10 frames
    name: err.name,
    code: err.code,
    statusCode,
    isOperational,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?._id || req.user?.id || 'anonymous',
    body: safeBodyForLog,
    params: req.params,
    query: req.query
  }));

  // Send to Sentry with smart filtering
  // Strategy: All 5xx + critical 4xx patterns
  const isCriticalClientError = 
    (statusCode === 401 && err.message.includes('token')) || // Auth attacks
    statusCode === 429 || // Rate limit abuse
    (statusCode === 400 && err.message.includes('validation') && process.env.NODE_ENV === 'development'); // Dev bugs

  if ((isServerError || isCriticalClientError) && (global.Sentry || (typeof global !== 'undefined' && global.Sentry))) {
    try {
      global.Sentry.captureException(err, {
        tags: {
          errorId,
          requestId: req.requestId || 'unknown',
          url: req.originalUrl,
          method: req.method,
          statusCode,
          isOperational,
          isCriticalClientError
        },
        fingerprint: [
          'backend',
          err.name || 'UnknownError',
          err.message.split('\n')[0], // First line only
          String(statusCode)
        ],
        extra: {
          body: safeBodyForLog,
          params: req.params,
          query: req.query,
          userId: req.user?._id || req.user?.id || 'anonymous'
        }
      });
    } catch (sentryError) {
      // Don't let Sentry errors break error handling
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to send error to Sentry',
        sentryError: sentryError.message
      }));
    }
  }

  // Build safe error response (NEVER expose stack traces)
  const safeMessage = getSafeMessage(err, isOperational);

  // Log warning for non-operational errors (need investigation)
  if (!isOperational) {
    console.warn(JSON.stringify({
      level: 'warn',
      errorId,
      message: 'Non-operational error detected (requires investigation)',
      name: err.name,
      originalMessage: err.message,
      url: req.originalUrl
    }));
  }

  // Send response (secure by default)
  res.status(statusCode).json({
    success: false,
    status: err.status || 'error',
    message: safeMessage,
    errorId, // User can report this ID to support
    code: err.code || getErrorCode(statusCode),
    errors: err.errors || undefined // Validation errors (safe)
    // 🚫 NO stack traces
    // 🚫 NO detailedError
    // 🚫 NO internal paths
    // 🚫 NO dynamic error messages (even from operational errors)
  });
};

/**
 * Sanitize request body before logging (remove sensitive data)
 * @deprecated Use deepSanitize() instead
 */
function sanitizeBody(body) {
  return deepSanitize(body);
}

/**
 * Request ID middleware - adds unique ID to every request for tracing
 * MUST be added early in middleware chain (before routes)
 */
export const requestLogger = (req, res, next) => {
  // Generate unique request ID
  req.requestId = crypto.randomUUID();
  
  // Add to response headers ONLY (industry standard, no response bloat)
  res.setHeader('X-Request-ID', req.requestId);
  
  // Also add to error responses (for support correlation)
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    // Handle edge cases: null, strings, arrays
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Only add requestId to error responses (avoid schema changes for success)
      if (data.success === false || data.error) {
        data = { ...data, requestId: req.requestId };
      }
    }
    return originalJson(data);
  };
  
  next();
};

/**
 * Get error code from status code
 */
function getErrorCode(statusCode) {
  const codeMap = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE'
  };
  
  return codeMap[statusCode] || 'UNKNOWN_ERROR';
}

// Not found middleware
export const notFound = (req, res, next) => {
  const error = new AppError(`Route not found`, 404);
  next(error);
};

// Async handler wrapper to avoid try-catch in every route
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
