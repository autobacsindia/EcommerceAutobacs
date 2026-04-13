/**
 * Query Parameter Sanitization & SQL Injection Prevention
 * 
 * CRITICAL RULE: Sanitization is NOT the primary defense against SQL injection.
 * Parameterized queries are MANDATORY. Sanitization is an optional extra layer.
 * 
 * This module provides:
 * 1. String sanitization (removes dangerous characters)
 * 2. Type validation and coercion
 * 3. Input length limits
 * 4. Centralized sanitization functions for future SQL migration
 * 
 * Usage:
 *   import { sanitizeString, sanitizeSearchQuery, validateId } from './middleware/querySanitizer.js';
 */

// ── Configuration ───────────────────────────────────────────────────────────

const MAX_LENGTHS = {
  searchQuery: 200,
  productName: 200,
  userEmail: 255,
  description: 5000,
  tag: 50,
  brand: 100,
  sku: 100
};

// ── 1. String Sanitization (Extra Layer, NOT Primary Defense) ───────────────

/**
 * Sanitize string input
 * 
 * IMPORTANT: This is NOT a substitute for parameterized queries!
 * It's an additional defense layer.
 * 
 * Removes:
 * - SQL injection characters (for future SQL migration)
 * - NoSQL injection operators
 * - Null bytes
 * - Excessive whitespace
 */
export const sanitizeString = (input, options = {}) => {
  if (typeof input !== 'string') {
    return input;
  }

  const {
    maxLength = 500,
    allowHtml = false,
    trim = true
  } = options;

  let sanitized = input;

  // Trim whitespace
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Remove null bytes (security risk)
  sanitized = sanitized.replace(/\0/g, '');

  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove NoSQL injection operators ($ and .)
  sanitized = sanitized.replace(/[$.]/g, '');

  // Remove common SQL injection patterns (extra layer)
  // Note: This is NOT a substitute for parameterized queries!
  if (!allowHtml) {
    // Remove common SQL keywords used in attacks
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC)\b)/gi,
      /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi, // OR 1=1, AND 1=1
      /(--|\/\*|\*\/|;)/g, // SQL comments and statement terminator
      /(\b(UNION\s+SELECT)\b)/gi // UNION SELECT
    ];

    // Only log if suspicious patterns found (don't block, just sanitize)
    for (const pattern of sqlPatterns) {
      if (pattern.test(sanitized)) {
        console.warn('[Security] Suspicious SQL pattern detected:', {
          pattern: pattern.source,
          input: sanitized.substring(0, 100)
        });
        // Remove the pattern (extra defense)
        sanitized = sanitized.replace(pattern, '');
      }
    }
  }

  return sanitized;
};

// ── 2. Type Validation & Coercion ───────────────────────────────────────────

/**
 * Validate and sanitize ID (MongoDB ObjectId or UUID)
 * 
 * Returns sanitized ID or throws error if invalid
 */
export const validateId = (id, fieldName = 'id') => {
  if (!id || typeof id !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }

  // Trim whitespace
  const trimmed = id.trim();

  // Validate MongoDB ObjectId format (24 hex characters)
  const objectIdPattern = /^[a-fA-F0-9]{24}$/;
  if (objectIdPattern.test(trimmed)) {
    return trimmed;
  }

  // Validate UUID format
  const uuidPattern = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
  if (uuidPattern.test(trimmed)) {
    return trimmed;
  }

  // Validate numeric ID (for future SQL migration)
  const numericPattern = /^\d+$/;
  if (numericPattern.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid ${fieldName} format: ${id.substring(0, 50)}`);
};

/**
 * Validate and coerce integer
 */
export const validateInteger = (value, options = {}) => {
  const { min, max, required = false, fieldName = 'value' } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }
    return undefined;
  }

  const num = Number(value);

  if (!Number.isInteger(num)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  if (min !== undefined && num < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }

  if (max !== undefined && num > max) {
    throw new Error(`${fieldName} must be <= ${max}`);
  }

  return num;
};

/**
 * Validate and coerce float/decimal
 */
export const validateFloat = (value, options = {}) => {
  const { min, max, required = false, fieldName = 'value' } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }
    return undefined;
  }

  const num = Number(value);

  if (isNaN(num)) {
    throw new Error(`${fieldName} must be a number`);
  }

  if (min !== undefined && num < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }

  if (max !== undefined && num > max) {
    throw new Error(`${fieldName} must be <= ${max}`);
  }

  return num;
};

// ── 3. Search Query Sanitization ────────────────────────────────────────────

/**
 * Sanitize search query parameters
 * 
 * Specifically designed for search/filter endpoints
 */
export const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') {
    return '';
  }

  return sanitizeString(query, {
    maxLength: MAX_LENGTHS.searchQuery,
    allowHtml: false,
    trim: true
  });
};

/**
 * Sanitize filter parameters (for MongoDB queries)
 * 
 * Prevents NoSQL injection in filter objects
 */
export const sanitizeFilter = (filter) => {
  if (!filter || typeof filter !== 'object') {
    return {};
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(filter)) {
    // Remove keys starting with $ or containing . (NoSQL injection)
    if (key.startsWith('$') || key.includes('.')) {
      console.warn('[Security] NoSQL injection attempt detected:', { key });
      continue;
    }

    // Sanitize string values
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, { maxLength: 200 });
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeFilter(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

// ── 4. Email Sanitization ───────────────────────────────────────────────────

/**
 * Sanitize and validate email
 */
export const sanitizeEmail = (email) => {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }

  // Trim and lowercase
  const sanitized = email.trim().toLowerCase();

  // Remove null bytes
  const cleaned = sanitized.replace(/\0/g, '');

  // Basic email validation
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(cleaned)) {
    throw new Error('Invalid email format');
  }

  // Max length
  if (cleaned.length > MAX_LENGTHS.userEmail) {
    throw new Error(`Email must be less than ${MAX_LENGTHS.userEmail} characters`);
  }

  return cleaned;
};

// ── 5. URL Sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize URL input
 */
export const sanitizeUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();

  // Remove null bytes
  const cleaned = trimmed.replace(/\0/g, '');

  // Basic URL validation
  try {
    new URL(cleaned);
    return cleaned;
  } catch (error) {
    // Not a valid URL
    console.warn('[Security] Invalid URL:', cleaned.substring(0, 100));
    return '';
  }
};

// ── 6. Request Object Sanitization ──────────────────────────────────────────

/**
 * Sanitize entire request object (body, query, params)
 */
export const sanitizeRequest = (req) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeQueryObject(req.query);
  }

  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  return req;
};

/**
 * Sanitize object recursively
 */
export const sanitizeObject = (obj, depth = 0) => {
  // Prevent prototype pollution
  if (depth > 10) {
    console.warn('[Security] Max sanitization depth exceeded');
    return obj;
  }

  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  const sanitized = {};

  for (const key of Object.keys(obj)) {
    // Remove NoSQL injection operators from keys
    if (key.startsWith('$') || key.includes('.')) {
      console.warn('[Security] NoSQL injection attempt in key:', key);
      continue;
    }

    const value = obj[key];

    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, { maxLength: 500 });
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Sanitize query parameters (more restrictive)
 */
export const sanitizeQueryObject = (query) => {
  if (!query || typeof query !== 'object') {
    return {};
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(query)) {
    // Remove NoSQL injection operators
    if (key.startsWith('$') || key.includes('.')) {
      console.warn('[Security] NoSQL injection attempt in query key:', key);
      continue;
    }

    // Query params are always strings or arrays of strings
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, { maxLength: 200 });
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(v =>
        typeof v === 'string' ? sanitizeString(v, { maxLength: 200 }) : v
      );
    } else {
      // Coerce to string for query params
      sanitized[key] = String(value);
    }
  }

  return sanitized;
};

// ── 7. Future-Proof SQL Query Builder Helper ────────────────────────────────

/**
 * Query builder helper for future SQL migration
 * 
 * This demonstrates the pattern you should use when migrating to SQL:
 * 
 * CURRENT (MongoDB - safe with Mongoose):
 *   await Product.find({ name: sanitizeString(req.query.name) });
 * 
 * FUTURE (SQL - MUST use parameterized queries):
 *   await db.query('SELECT * FROM products WHERE name = $1', [sanitizeString(req.query.name)]);
 * 
 * NEVER DO:
 *   await db.query(`SELECT * FROM products WHERE name = '${req.query.name}'`);
 */
export const QueryHelper = {
  /**
   * Build safe MongoDB query
   */
  buildMongoQuery: (filters) => {
    return sanitizeFilter(filters);
  },

  /**
   * Build safe SQL query (for future migration)
   * 
   * IMPORTANT: This returns parameterized query, NOT raw SQL string!
   */
  buildSQLQuery: (template, params) => {
    // Validate that template uses parameterized placeholders ($1, $2, etc. or ?, ?)
    const hasPlaceholders = /\$[\d]+|\?/.test(template);

    if (!hasPlaceholders) {
      throw new Error('SQL query must use parameterized placeholders ($1, $2 or ?)');
    }

    // Sanitize all parameters
    const sanitizedParams = params.map(param => {
      if (typeof param === 'string') {
        return sanitizeString(param, { maxLength: 1000 });
      }
      return param;
    });

    return {
      query: template,
      params: sanitizedParams
    };
  }
};

// ── 8. Express Middleware ───────────────────────────────────────────────────

/**
 * Express middleware to sanitize all request inputs
 * 
 * Usage:
 *   import { sanitizeRequestMiddleware } from './middleware/querySanitizer.js';
 *   app.use(sanitizeRequestMiddleware);
 */
export const sanitizeRequestMiddleware = (req, res, next) => {
  try {
    sanitizeRequest(req);
    next();
  } catch (error) {
    console.error('[Security] Request sanitization error:', error.message);
    next(error);
  }
};
