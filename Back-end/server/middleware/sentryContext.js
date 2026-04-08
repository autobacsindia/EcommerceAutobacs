/**
 * Sentry Context Middleware
 * 
 * Adds user and request context to Sentry for better error tracking.
 * This allows you to see:
 * - Which users are affected by errors
 * - What request caused the error
 * - Full request details for debugging
 */

import * as Sentry from "@sentry/node";

/**
 * Sentry Context Middleware
 * 
 * Attaches user and request context to every request.
 * Should be added AFTER authentication middleware.
 */
export const sentryContextMiddleware = (req, res, next) => {
  // Skip if Sentry not configured
  if (!process.env.SENTRY_DSN) {
    return next();
  }

  // Add request context
  Sentry.setContext("request", {
    url: req.originalUrl || req.url,
    method: req.method,
    query: req.query,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
  });

  // Add user context if authenticated
  if (req.user) {
    Sentry.setUser({
      id: req.user._id?.toString(),
      email: req.user.email,
      role: req.user.role,
    });
  } else if (req.sessionID) {
    // For guest users, track by session
    Sentry.setUser({
      id: `session:${req.sessionID}`,
    });
  }

  // Add tags for filtering
  Sentry.setTag("route", req.originalUrl || req.url);
  Sentry.setTag("method", req.method);

  next();
};

/**
 * Manual Error Capture Helper
 * 
 * Use this for business logic errors that don't crash the app
 * but should be tracked (e.g., payment failures, validation errors)
 * 
 * Usage:
 *   captureBusinessError(err, { context: 'payment', userId: user._id })
 */
export const captureBusinessError = (error, context = {}) => {
  if (!process.env.SENTRY_DSN) {
    console.error('[Business Error]', error.message, context);
    return;
  }

  Sentry.withScope((scope) => {
    // Add custom context
    if (context) {
      scope.setContext("business_context", context);
    }

    // Capture the error
    Sentry.captureException(error);
  });

  console.error(`[Business Error] ${error.message}`, context);
};
