/**
 * Session Management & Refresh Token Utility
 * Handles refresh token generation, rotation, and revocation
 * Integrated with Redis for distributed session management
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import sessionStore from '../services/sessionStore.js';
import { signToken } from './jwtSecretManager.js';

/**
 * Generate a secure refresh token
 * @returns {string} - Secure random refresh token
 */
export const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Generate access and refresh tokens for a user
 * @param {Object} user - User object
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 * @returns {Object} - { accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry }
 */
export const generateTokenPair = (user, ipAddress = null, userAgent = null) => {
  // Generate access token with role-based expiration
  let accessTokenExpiry;
  if (user.role === 'admin') {
    accessTokenExpiry = process.env.JWT_ADMIN_EXPIRE || '15m'; // 15 minutes for admin
  } else {
    accessTokenExpiry = process.env.JWT_EXPIRE || '30m'; // 30 minutes for regular users
  }
  
  // Use rotation-aware signing (always uses primary secret)
  const accessToken = signToken(
    { id: user._id, role: user.role },
    { expiresIn: accessTokenExpiry }
  );

  // Generate refresh token
  const refreshToken = generateRefreshToken();
  
  // Refresh token expiry: 30 days
  const refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    accessToken,
    refreshToken,
    accessTokenExpiry,
    refreshTokenExpiry,
    deviceInfo: userAgent,
    ipAddress
  };
};

/**
 * Store refresh token in user document AND Redis
 * @param {Object} user - User mongoose document
 * @param {string} refreshToken - Refresh token to store
 * @param {Date} expiresAt - Expiration date
 * @param {string} ipAddress - Client IP address
 * @param {string} deviceInfo - Device information
 */
export const storeRefreshToken = async (user, refreshToken, expiresAt, ipAddress = null, deviceInfo = null) => {
  // Hash the refresh token before storing
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  // Clean up expired tokens
  user.refreshTokens = user.refreshTokens.filter(rt => rt.expiresAt > new Date());
  
  // Limit to 5 active sessions per user
  if (user.refreshTokens.length >= 5) {
    // Remove oldest token
    user.refreshTokens.sort((a, b) => a.createdAt - b.createdAt);
    user.refreshTokens.shift();
  }
  
  // Add new refresh token to MongoDB (backup)
  user.refreshTokens.push({
    token: hashedToken,
    expiresAt,
    ipAddress,
    deviceInfo
  });
  
  await user.save();
  
  // ALSO store in Redis for fast validation and distributed access (NEW!)
  const ttlSeconds = Math.floor((expiresAt - new Date()) / 1000);
  await sessionStore.storeSession(
    user._id.toString(),
    hashedToken,
    { ipAddress, deviceInfo },
    ttlSeconds
  );
};

/**
 * Validate and verify refresh token (checks Redis first, then MongoDB)
 * @param {Object} user - User mongoose document
 * @param {string} refreshToken - Refresh token to validate
 * @returns {Promise<boolean>} - True if valid, false otherwise
 */
export const validateRefreshToken = async (user, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  // FIRST check Redis (fast path for distributed validation)
  try {
    const redisValid = await sessionStore.validateSession(user._id.toString(), hashedToken);
    if (!redisValid) {
      return false; // Session revoked or expired in Redis
    }
    
    // SLIDING EXPIRATION: Refresh TTL on each valid request
    const ttlSeconds = 30 * 24 * 60 * 60; // 30 days
    await sessionStore.refreshSessionTTL(user._id.toString(), hashedToken, ttlSeconds);
  } catch (err) {
    // If Redis fails in production, throw error (fail closed)
    if (process.env.NODE_ENV === 'production') {
      console.error('[Session] Redis validation failed:', err.message);
      throw new Error(`Session validation failed: ${err.message}`);
    }
    // In dev, continue to MongoDB fallback
    console.warn('[Session] Redis unavailable, falling back to MongoDB (dev mode)');
  }
  
  // THEN check MongoDB (source of truth + cache rehydration with stampede protection)
  const tokenRecord = user.refreshTokens.find(
    rt => rt.token === hashedToken && rt.expiresAt > new Date()
  );
  
  // If MongoDB has it but Redis doesn't, rehydrate Redis cache (cache miss recovery)
  if (tokenRecord && process.env.NODE_ENV === 'production') {
    const lockKey = `lock:rehydrate:${user._id}:${hashedToken}`;
    
    try {
      // ACQUIRE LOCK with TOKEN (prevents cache stampede)
      const lockToken = await sessionStore.acquireLock(lockKey, 5); // 5s lock
      
      if (lockToken) {
        try {
          // Double-check after acquiring lock (another request may have rehydrated)
          const alreadyRehydrated = await sessionStore.validateSession(user._id.toString(), hashedToken);
          
          if (!alreadyRehydrated) {
            // Only ONE request rehydrates
            const ttlSeconds = Math.floor((tokenRecord.expiresAt - new Date()) / 1000);
            await sessionStore.storeSession(
              user._id.toString(),
              hashedToken,
              { ipAddress: tokenRecord.ipAddress, deviceInfo: tokenRecord.deviceInfo },
              ttlSeconds
            );
            console.log(`[Session] Rehydrated Redis cache for user ${user._id} (stampede protected)`);
          } else {
            console.log(`[Session] Cache already rehydrated by another request`);
          }
        } finally {
          // ALWAYS release lock with TOKEN (safety)
          await sessionStore.releaseLock(lockKey, lockToken);
        }
      } else {
        // Lock not acquired - another request is rehydrating
        // Wait briefly and retry validation
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms wait
        const retryValid = await sessionStore.validateSession(user._id.toString(), hashedToken);
        
        if (retryValid) {
          console.log(`[Session] Used rehydrated cache from concurrent request`);
        }
      }
    } catch (rehydrateErr) {
      console.error('[Session] Failed to rehydrate Redis cache:', rehydrateErr.message);
      // Don't fail the request - just log the error
    }
  }
  
  return !!tokenRecord;
};

/**
 * Find user by refresh token
 * @param {Model} UserModel - User mongoose model
 * @param {string} refreshToken - Refresh token to search for
 * @returns {Promise<Object|null>} - User document or null
 */
export const findUserByRefreshToken = async (UserModel, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  return await UserModel.findOne({ 'refreshTokens.token': hashedToken });
};

/**
 * Revoke a specific refresh token (from both MongoDB and Redis)
 * @param {Object} user - User mongoose document
 * @param {string} refreshToken - Refresh token to revoke
 */
export const revokeRefreshToken = async (user, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  // Remove from MongoDB
  user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== hashedToken);
  await user.save();
  
  // ALSO remove from Redis for immediate distributed invalidation (NEW!)
  await sessionStore.revokeSession(user._id.toString(), hashedToken);
};

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 * @param {Object} user - User mongoose document
 */
export const revokeAllRefreshTokens = async (user) => {
  // Clear MongoDB
  user.refreshTokens = [];
  await user.save();
  
  // ALSO clear all Redis sessions for immediate distributed logout (NEW!)
  await sessionStore.revokeAllSessions(user._id.toString());
};

/**
 * Rotate refresh token (generate new one and revoke old one)
 * @param {Object} user - User mongoose document
 * @param {string} oldRefreshToken - Old refresh token to revoke
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 * @returns {Object} - New token pair
 */
export const rotateRefreshToken = async (user, oldRefreshToken, ipAddress = null, userAgent = null) => {
  // Revoke old token
  await revokeRefreshToken(user, oldRefreshToken);
  
  // Generate new token pair
  const tokens = generateTokenPair(user, ipAddress, userAgent);
  
  // Store new refresh token
  await storeRefreshToken(
    user,
    tokens.refreshToken,
    tokens.refreshTokenExpiry,
    ipAddress,
    userAgent
  );
  
  return tokens;
};

/**
 * Log login attempt for security audit
 * @param {Object} user - User mongoose document
 * @param {boolean} success - Whether login was successful
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 */
export const logLoginAttempt = async (user, success, ipAddress = null, userAgent = null) => {
  // Keep only last 20 login attempts
  if (user.loginAttempts.length >= 20) {
    user.loginAttempts = user.loginAttempts.slice(-19);
  }
  
  user.loginAttempts.push({
    timestamp: new Date(),
    ipAddress,
    success,
    userAgent
  });
  
  if (success) {
    user.lastLoginAt = new Date();
    user.lastLoginIp = ipAddress;
  }
  
  await user.save();
};

/**
 * Clean up expired refresh tokens across all users
 * Should be run periodically (e.g., daily cron job)
 * @param {Model} UserModel - User mongoose model
 */
export const cleanupExpiredTokens = async (UserModel) => {
  try {
    const result = await UserModel.updateMany(
      { 'refreshTokens.expiresAt': { $lt: new Date() } },
      { $pull: { refreshTokens: { expiresAt: { $lt: new Date() } } } }
    );
    console.log(`[Session] Cleaned up expired tokens for ${result.modifiedCount} users`);
    return result;
  } catch (error) {
    console.error('[Session] Error cleaning up expired tokens:', error);
    throw error;
  }
};

/**
 * Set refresh token cookie on response
 * @param {Object} res - Express response object
 * @param {string} token - Refresh token
 * @param {Date} expiresAt - Expiration date
 */
export const setRefreshTokenCookie = (res, token, expiresAt) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax', // Strict for production
    path: '/', // Allow on all paths so logout can work
    expires: expiresAt
  };
  
  res.cookie('refreshToken', token, cookieOptions);
};

/**
 * Clear refresh token cookie on response
 * @param {Object} res - Express response object
 */
export const clearRefreshTokenCookie = (res) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/'
  };
  
  res.clearCookie('refreshToken', cookieOptions);
};
