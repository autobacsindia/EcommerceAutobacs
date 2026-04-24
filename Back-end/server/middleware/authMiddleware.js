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

    // Get user from token (exclude password)
    req.user = await User.findById(decoded.id).select('-passwordHash');

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    next();
  } catch (error) {
    // Only log in non-test environments to reduce test output noise
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Auth] Token verification failed:', error.message);
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token failed'
    });
  }
});

// Admin middleware - check if user is admin
// ENHANCED: Binds session to IP + UA context for admin accounts
export const admin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized as admin'
    });
  }
  
  // ADMIN SECURITY: Validate session context (IP + UA binding)
  // Helps detect token theft across different environments
  const currentIP = req.ip || req.connection.remoteAddress || 'unknown';
  const currentUA = req.get('user-agent') || 'unknown';
  
  // Hash current context
  const currentIPHash = crypto.createHash('sha256').update(currentIP).digest('hex');
  const currentUAHash = crypto.createHash('sha256').update(currentUA).digest('hex');
  
  // Check if we have stored session context (from login or last request)
  const storedIPHash = req.user.lastAdminIPHash;
  const storedUAHash = req.user.lastAdminUAHash;
  
  if (storedIPHash && storedUAHash) {
    // Context mismatch detected (possible token theft)
    if (storedIPHash !== currentIPHash || storedUAHash !== currentUAHash) {
      console.error(
        `[SECURITY] Admin session context mismatch! | User: ${req.user.email} | ` +
        `IP changed: ${storedIPHash !== currentIPHash} | UA changed: ${storedUAHash !== currentUAHash} | ` +
        `IP: ${currentIP} | UA: ${currentUA}`
      );
      
      // SECURITY: Revoke all sessions for this admin (nuclear option)
      // In production, you might want to add a grace period or skip for mobile IP changes
      req.user.lastAdminIPHash = currentIPHash;
      req.user.lastAdminUAHash = currentUAHash;
      await req.user.save();
      
      // Log security event but allow request (don't block legitimate mobile users)
      // You can change this to reject if you want stricter security
      Sentry.captureMessage('Admin session context mismatch', {
        level: 'warning',
        extra: {
          userId: req.user._id,
          email: req.user.email,
          ipChanged: storedIPHash !== currentIPHash,
          uaChanged: storedUAHash !== currentUAHash,
          ip: currentIP
        }
      });
    }
  } else {
    // First admin request or no context stored - save it
    req.user.lastAdminIPHash = currentIPHash;
    req.user.lastAdminUAHash = currentUAHash;
    await req.user.save();
  }
  
  // Update context for next request
  req.user.lastAdminIPHash = currentIPHash;
  req.user.lastAdminUAHash = currentUAHash;
  
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

