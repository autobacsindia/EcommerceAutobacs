import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "./errorMiddleware.js";
import * as Sentry from "@sentry/node";
import { verifyTokenWithRotation } from "../utils/jwtSecretManager.js";
import crypto from 'crypto';

// Protect routes - verify JWT token with rotation support
export const protect = asyncHandler(async (req, res, next) => {
  let token;

  // PRIORITY 1: Check for access token in httpOnly cookie (SECURE - XSS protected)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // PRIORITY 2: Check for token in Authorization header (backward compatibility for mobile/API clients)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }

  try {
    // Verify token with rotation support (tries all active secrets)
    const decoded = verifyTokenWithRotation(token, { algorithms: ['HS256'] });

    // Get user from token (exclude passwordHash, sessionVersion included by default)
   req.user = await User.findById(decoded.id).select('-passwordHash');

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // CRITICAL: Validate session version (instant revocation check)
    // If sessionVersion in DB > sessionVersion in JWT → token is revoked
    const tokenSessionVersion = decoded.sessionVersion || 0;
    const dbSessionVersion = req.user.sessionVersion || 0;

    if (tokenSessionVersion !== dbSessionVersion) {
      // Token is from old session (revoked by logout all / password change)
      console.warn(`[Auth] Session version mismatch | User: ${req.user._id} | Token: ${tokenSessionVersion}, DB: ${dbSessionVersion}`);
      
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.',
        code: 'SESSION_REVOKED'
      });
    }

    // CRITICAL: Check token issued time against security events
    // Prevents token replay if tokenInvalidBefore is set
    if (req.user.tokenInvalidBefore) {
      const tokenIssuedAt = decoded.iat * 1000; // Convert to milliseconds
      const invalidBefore = new Date(req.user.tokenInvalidBefore).getTime();
      
      if (tokenIssuedAt < invalidBefore) {
        console.warn(`[Auth] Token issued before security event | User: ${req.user._id} | Token IAT: ${tokenIssuedAt}, Invalid Before: ${invalidBefore}`);
        
        return res.status(401).json({
          success: false,
          message: 'Session expired due to security event. Please login again.',
          code: 'SESSION_INVALIDATED'
        });
      }
    }

    next();
  } catch (error) {
    // Only log in non-test environments to reduce test output noise
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Auth] Token verification failed:', {
        message: error.message,
        hasCookie: !!req.cookies?.accessToken,
        hasHeader: !!req.headers?.authorization,
        tokenLength: token?.length || 0
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token failed'
    });
  }
});

// Admin middleware - check if user is admin
// SECURITY: Binds every admin request to the IP + UA captured at login.
// Both hashes must be present (set during login) and must match the current
// request. A missing hash means the session predates context-binding or login
// failed to write hashes — reject to force a fresh login in either case.
export const admin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized as admin'
    });
  }

  // Use cf-connecting-ip first so the value is consistent with what was stored
  // at login (login uses the same priority order).
  const currentIP = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress || 'unknown';
  const currentUA = req.get('user-agent') || 'unknown';

  const currentIPHash = crypto.createHash('sha256').update(currentIP).digest('hex');
  const currentUAHash = crypto.createHash('sha256').update(currentUA).digest('hex');

  const storedIPHash = req.user.lastAdminIPHash;
  const storedUAHash = req.user.lastAdminUAHash;

  if (!storedIPHash || !storedUAHash) {
    console.error(
      `[SECURITY] Admin session missing context hashes | User: ${req.user.email} | IP: ${currentIP}`
    );
    Sentry.captureMessage('Admin session missing context hashes — access denied', {
      level: 'error',
      extra: { userId: req.user._id, email: req.user.email, ip: currentIP }
    });
    return res.status(401).json({
      success: false,
      message: 'Session context not initialized. Please login again.',
      code: 'context_missing'
    });
  }

  if (storedIPHash !== currentIPHash || storedUAHash !== currentUAHash) {
    console.error(
      `[SECURITY] Admin session context mismatch | User: ${req.user.email} | ` +
      `IP changed: ${storedIPHash !== currentIPHash} | UA changed: ${storedUAHash !== currentUAHash} | ` +
      `IP: ${currentIP} | UA: ${currentUA}`
    );
    Sentry.captureMessage('Admin session context mismatch — access denied', {
      level: 'error',
      extra: {
        userId: req.user._id,
        email: req.user.email,
        ipChanged: storedIPHash !== currentIPHash,
        uaChanged: storedUAHash !== currentUAHash,
        ip: currentIP
      }
    });
    return res.status(401).json({
      success: false,
      message: 'Session context changed. Please login again.',
      code: 'context_mismatch'
    });
  }

  next();
});

// Optional auth middleware - populate req.user if token exists, but don't reject if missing
export const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  // PRIORITY 1: Check for access token in httpOnly cookie (SECURE - XSS protected)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // PRIORITY 2: Check for token in Authorization header (backward compatibility)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // If no token, just continue without setting req.user
  if (!token) {
    return next();
  }

  try {
    // Verify token with rotation support
    const decoded = verifyTokenWithRotation(token, { algorithms: ['HS256'] });

    // Get user from token (exclude password)
    req.user = await User.findById(decoded.id).select('-passwordHash');

    // If user not found, just continue without req.user
    if (!req.user) {
      return next();
    }

    // Session version check — revoked tokens must not grant user context
    const tokenSessionVersion = decoded.sessionVersion || 0;
    const dbSessionVersion = req.user.sessionVersion || 0;
    if (tokenSessionVersion !== dbSessionVersion) {
      req.user = null;
      return next();
    }

    // tokenInvalidBefore check — tokens issued before a security event are invalid
    if (req.user.tokenInvalidBefore) {
      const tokenIssuedAt = decoded.iat * 1000;
      const invalidBefore = new Date(req.user.tokenInvalidBefore).getTime();
      if (tokenIssuedAt < invalidBefore) {
        req.user = null;
        return next();
      }
    }

    next();
  } catch (error) {
    // If token is invalid, just continue without req.user
    // Only log in non-test environments
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Invalid token in optional auth:', error.message);
    }
    next();
  }
});

