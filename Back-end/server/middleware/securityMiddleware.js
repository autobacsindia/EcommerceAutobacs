/**
 * Advanced Security Middleware
 * 
 * Provides production-grade security features:
 * - JSON depth limiting (prevent JSON bomb attacks)
 * - Field count limiting (prevent DoS via many fields)
 * - Strict field whitelisting (prevent field injection)
 * - Input normalization
 * - Request sanitization
 * 
 * Usage:
 *   import { limitJsonDepth, limitFieldCount, whitelistFields } from './middleware/securityMiddleware.js';
 *   
 *   router.post('/products',
 *     limitJsonDepth(5),
 *     limitFieldCount(50),
 *     whitelistFields(['name', 'description', 'price']),
 *     createProduct
 *   );
 */

import sanitizeHtml from 'sanitize-html';

// ── JSON Depth Limiter ──────────────────────────────────────────────────────

/**
 * Prevent JSON bomb attacks by limiting nesting depth
 * 
 * Attack example:
 * { "a": { "b": { "c": { "d": { ... 1000 levels deep }}}}
 * 
 * @param {number} maxDepth - Maximum allowed depth (default: 5)
 */
export const limitJsonDepth = (maxDepth = 5) => {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const checkDepth = (obj, currentDepth = 0) => {
      if (currentDepth > maxDepth) {
        return false;
      }
      if (typeof obj !== 'object' || obj === null) {
        return true;
      }
      return Object.values(obj).every(value => 
        checkDepth(value, currentDepth + 1)
      );
    };

    if (!checkDepth(req.body)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'JSON_DEPTH_EXCEEDED',
          message: `Request nesting depth exceeds maximum of ${maxDepth} levels`
        }
      });
    }

    next();
  };
};

// ── Field Count Limiter ─────────────────────────────────────────────────────

/**
 * Prevent DoS attacks via excessive number of fields
 * 
 * Attack example:
 * { "a1": "...", "a2": "...", ..., "a10000": "..." }
 * 
 * @param {number} maxFields - Maximum allowed fields (default: 50)
 */
export const limitFieldCount = (maxFields = 50) => {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const fieldCount = Object.keys(req.body).length;
    
    if (fieldCount > maxFields) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_FIELDS',
          message: `Request contains ${fieldCount} fields, maximum allowed is ${maxFields}`
        }
      });
    }

    next();
  };
};

// ── Field Whitelist (Strict) ────────────────────────────────────────────────

/**
 * Strictly filter request body to only include allowed fields
 * Prevents field injection attacks like { "role": "admin", "isAdmin": true }
 * 
 * @param {string[]} allowedFields - List of allowed field names
 * @param {Object} options - Configuration options
 * @param {boolean} options.logUnknown - Log unknown fields (default: true)
 * @param {boolean} options.strict - Reject request if unknown fields found (default: false)
 */
export const whitelistFields = (allowedFields, options = {}) => {
  const { logUnknown = true, strict = false } = options;

  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const originalKeys = Object.keys(req.body);
    const filteredBody = {};
    const unknownFields = [];

    for (const key of originalKeys) {
      if (allowedFields.includes(key)) {
        filteredBody[key] = req.body[key];
      } else {
        unknownFields.push(key);
      }
    }

    // Log unknown fields for security monitoring
    if (logUnknown && unknownFields.length > 0) {
      console.warn(`[Security] Unknown fields rejected:`, {
        path: req.path,
        method: req.method,
        fields: unknownFields,
        ip: req.ip
      });
    }

    // In strict mode, reject the entire request
    if (strict && unknownFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNKNOWN_FIELDS',
          message: `Request contains unknown fields: ${unknownFields.join(', ')}`,
          allowedFields
        }
      });
    }

    // Replace body with filtered version
    req.body = filteredBody;
    next();
  };
};

// ── Input Normalization ─────────────────────────────────────────────────────

/**
 * Normalize input data to prevent inconsistencies
 * - Trim strings
 * - Lowercase emails
 * - Remove null bytes
 * - Normalize whitespace
 */
export const normalizeInput = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  const normalize = (obj) => {
    for (const key of Object.keys(obj)) {
      const value = obj[key];

      if (typeof value === 'string') {
        // Remove null bytes (security risk)
        obj[key] = value.replace(/\0/g, '');
        
        // Trim whitespace
        obj[key] = obj[key].trim();
        
        // Normalize whitespace (multiple spaces → single space)
        obj[key] = obj[key].replace(/\s+/g, ' ');
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively normalize nested objects
        normalize(value);
      } else if (Array.isArray(value)) {
        // Normalize array items
        value.forEach((item, index) => {
          if (typeof item === 'string') {
            value[index] = item.replace(/\0/g, '').trim().replace(/\s+/g, ' ');
          } else if (typeof item === 'object' && item !== null) {
            normalize(item);
          }
        });
      }
    }
  };

  normalize(req.body);

  // Special handling for email fields
  if (req.body.email && typeof req.body.email === 'string') {
    req.body.email = req.body.email.toLowerCase();
  }

  next();
};

// ── HTML Sanitization (Context-Aware) ───────────────────────────────────────

/**
 * Sanitize HTML content while preserving allowed tags
 * Use this for fields that legitimately contain HTML (descriptions, comments)
 * 
 * @param {string[]} fields - Fields to sanitize
 * @param {Object} options - sanitize-html options
 */
export const sanitizeHtmlFields = (fields, options = {}) => {
  const defaultOptions = {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
    allowedAttributes: {
      'a': ['href', 'title', 'target']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard'
  };

  const config = { ...defaultOptions, ...options };

  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    for (const field of fields) {
      if (req.body[field] && typeof req.body[field] === 'string') {
        req.body[field] = sanitizeHtml(req.body[field], config);
      }
    }

    next();
  };
};

// ── XSS Prevention (Output Sanitization Helper) ─────────────────────────────

/**
 * Sanitize string for safe output in different contexts
 * Import this in controllers to sanitize before sending to client
 * 
 * @param {string} str - String to sanitize
 * @param {string} context - Output context: 'html', 'js', 'url', 'attribute'
 * @returns {string} - Sanitized string
 */
export const sanitizeForOutput = (str, context = 'html') => {
  if (typeof str !== 'string') return str;

  switch (context) {
    case 'html':
      // Escape HTML entities
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

    case 'js':
      // Escape for JavaScript strings
      return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

    case 'url':
      // URL encode
      return encodeURIComponent(str);

    case 'attribute':
      // Escape for HTML attributes
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

    default:
      return str;
  }
};

// ── Combined Security Middleware ────────────────────────────────────────────

/**
 * Apply all security checks in one middleware
 * 
 * @param {Object} options - Security configuration
 */
export const applySecurityChecks = (options = {}) => {
  const {
    maxDepth = 5,
    maxFields = 50,
    allowedFields = null,
    normalize = true,
    sanitizeHtmlFields: htmlFields = []
  } = options;

  const middleware = [];

  // 1. Limit JSON depth
  middleware.push(limitJsonDepth(maxDepth));

  // 2. Limit field count
  middleware.push(limitFieldCount(maxFields));

  // 3. Normalize input
  if (normalize) {
    middleware.push(normalizeInput);
  }

  // 4. Whitelist fields (if provided)
  if (allowedFields) {
    middleware.push(whitelistFields(allowedFields, { logUnknown: true, strict: false }));
  }

  // 5. Sanitize HTML fields (if provided)
  if (htmlFields.length > 0) {
    middleware.push(sanitizeHtmlFields(htmlFields));
  }

  // Return composed middleware
  return middleware;
};
