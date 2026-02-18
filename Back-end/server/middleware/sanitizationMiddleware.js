import mongoSanitize from 'express-mongo-sanitize';

// Middleware to sanitize data against NoSQL injection
// This removes any keys starting with $ or containing . from req.body, req.query, and req.params
const sanitizer = mongoSanitize();
export const mongoSanitization = (req, res, next) => {
  // Skip in test environment to avoid potential conflicts with test payloads/mocks
  if (process.env.NODE_ENV === 'test') {
    // console.log('Skipping mongoSanitization in test env, NODE_ENV:', process.env.NODE_ENV);
    return next();
  }
  // console.log('Running mongoSanitization, NODE_ENV:', process.env.NODE_ENV);
  try {
    sanitizer(req, res, next);
  } catch (error) {
    console.error('MongoSanitization Error:', error);
    next(error);
  }
};

// Middleware to trim string inputs
export const requestSanitization = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
};

const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'string') {
        // Trim whitespace
        sanitized[key] = value.trim();
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  return sanitized;
};
