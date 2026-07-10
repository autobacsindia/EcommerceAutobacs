// Global error handling middleware for Express
// SECURITY: Never expose stack traces to clients (secure by default)
import AppError from '../utils/AppError.js';
import crypto from 'crypto';
import { sendP1Alert } from '../utils/alerting.js';

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

  // Coupon / loyalty rejection reasons (surfaced verbatim to the buyer)
  'This coupon is no longer available',
  'This coupon is not yet active',
  'This coupon has expired',
  'This coupon has reached its usage limit',
  'You have already used this coupon',
  'This coupon is valid on your first order only',
  'Please log in to use this coupon',
  'This coupon does not apply to the items in your cart',
  'Your cart does not meet this coupon’s minimum value',
  'Your cart exceeds this coupon’s maximum value',
  'Order total must be greater than zero',
  
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

  // Allow dynamic duplicate-key messages through — they contain field names, not internals
  if (isOperational && typeof err.message === 'string' && err.message.startsWith('Duplicate value:')) {
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

/**
 * Map raw driver/Mongoose errors onto our HTTP contract.
 *
 * These arrive with no `statusCode`, so without this they all defaulted to 500:
 * the client saw an opaque "Something went wrong", and every bad admin form
 * submit tripped the 5xx P1 alert. They are client errors, not server faults.
 *
 * Mutates `err` in place (it is per-request and about to be discarded) so the
 * rest of the handler — logging, getSafeMessage, the `errors` map — sees a
 * consistent shape.
 */
function normalizeKnownError(err) {
  if (typeof err?.statusCode === 'number') return; // caller already decided

  // Schema validation: `err.errors` is forwarded to the client as `errors`.
  if (err?.name === 'ValidationError' && err.errors) {
    err.statusCode = 400;
    err.isOperational = true;
    err.message = 'Validation Error'; // whitelisted; per-field detail rides in `errors`
    return;
  }

  // Malformed ObjectId / uncastable value in a query or payload.
  if (err?.name === 'CastError') {
    err.statusCode = 400;
    err.isOperational = true;
    err.message = 'Validation Error';
    return;
  }

  // Unique-index violation. `keyPattern`/`keyValue` name the field(s); we echo the
  // field name only, never the attempted value (could be PII, e.g. a user email).
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    err.statusCode = 409;
    err.isOperational = true;
    err.message = `Duplicate value: ${fields.join(', ') || 'field'} already exists`;
  }
}

export const errorHandler = (err, req, res, next) => {
  try {
    // Generate unique error ID for support tracking
    const errorId = crypto.randomUUID();

    normalizeKnownError(err);

    const statusCode = (typeof err.statusCode === 'number' ? err.statusCode : null)
      || (typeof err.status === 'number' ? err.status : null)
      || 500;
    const isOperational = err.isOperational === true;
    const isServerError = statusCode >= 500;

    // Sanitize and truncate body for logging (deep sanitization)
    let safeBodyForLog;
    try {
      safeBodyForLog = truncateLog(deepSanitize(req.body));
    } catch (_) {
      safeBodyForLog = '[body serialization failed]';
    }

    const safeStack = err.stack
      ? err.stack.split('\n').slice(0, 10).join('\n') + '\n  ...[TRUNCATED]'
      : 'No stack trace available';

    const errMsg = typeof err.message === 'string' ? err.message : String(err.message ?? '');

    try {
      console.error(JSON.stringify({
        level: 'error',
        errorId,
        requestId: req.requestId || 'unknown',
        timestamp: new Date().toISOString(),
        message: errMsg,
        stack: safeStack,
        name: err.name,
        code: err.code,
        statusCode,
        isOperational,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
        userId: req.user?._id || req.user?.id || 'anonymous',
        body: safeBodyForLog,
        params: req.params,
        query: req.query
      }));
    } catch (_) {
      console.error('[errorHandler] Failed to log error:', err.name, errMsg);
    }

    const isCriticalClientError =
      (statusCode === 401 && errMsg.includes('token')) ||
      statusCode === 429 ||
      (statusCode === 400 && errMsg.includes('validation') && process.env.NODE_ENV === 'development');

    if ((isServerError || isCriticalClientError) && global.Sentry) {
      try {
        global.Sentry.captureException(err, {
          tags: { errorId, url: req.originalUrl, method: req.method, statusCode },
          fingerprint: ['backend', err.name || 'UnknownError', errMsg.split('\n')[0], String(statusCode)],
          extra: { body: safeBodyForLog, params: req.params, query: req.query }
        });
      } catch (_) { /* never let Sentry crash error handling */ }
    }

    // P1 alert: fire for every 5xx in production (deduplicated by error name in alerting.js)
    if (isServerError) {
      // Guarded: if sendP1Alert ever throws synchronously or returns a non-promise,
      // a bare `.catch()` would blow up the last-resort error handler and downgrade
      // *every* 5xx to a bare "Internal server error" with no errorId and no logging.
      try {
        const alert = sendP1Alert({
          title: err.name || 'ServerError',
          errorId,
          url: req.originalUrl,
          method: req.method,
          statusCode,
          message: errMsg,
        });
        if (alert && typeof alert.catch === 'function') alert.catch(() => {}); // non-blocking
      } catch (_) { /* never let alerting crash error handling */ }
    }

    const safeMessage = getSafeMessage(err, isOperational);

    if (!isOperational) {
      try {
        console.warn(JSON.stringify({
          level: 'warn',
          errorId,
          message: 'Non-operational error detected (requires investigation)',
          name: err.name,
          originalMessage: errMsg,
          url: req.originalUrl
        }));
      } catch (_) { /* ignore */ }
    }

    // Safely extract validation errors (Mongoose ValidatorError objects may
    // contain schema/document references that cause JSON.stringify to throw)
    let safeErrors;
    if (err.errors && typeof err.errors === 'object') {
      try {
        safeErrors = Object.fromEntries(
          Object.entries(err.errors).map(([k, v]) => [
            k,
            typeof v === 'object' && v !== null ? (v.message || String(v)) : String(v)
          ])
        );
      } catch (_) {
        safeErrors = undefined;
      }
    }

    if (res.headersSent) return;

    res.status(statusCode).json({
      success: false,
      message: safeMessage,
      errorId,
      code: err.code || getErrorCode(statusCode),
      ...(safeErrors ? { errors: safeErrors } : {})
    });
  } catch (handlerError) {
    // Last resort: errorHandler itself crashed — send bare JSON to avoid HTML finalhandler
    console.error('[errorHandler] Crashed:', handlerError?.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
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
