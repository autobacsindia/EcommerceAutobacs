/**
 * Session Management & Refresh Token Utility
 * Handles refresh token generation, rotation, and revocation
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
  
  const accessToken = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
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
 * Store refresh token in user document
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
  
  // Add new refresh token
  user.refreshTokens.push({
    token: hashedToken,
    expiresAt,
    ipAddress,
    deviceInfo
  });
  
  await user.save();
};

/**
 * Validate and verify refresh token
 * @param {Object} user - User mongoose document
 * @param {string} refreshToken - Refresh token to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export const validateRefreshToken = (user, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  // Find matching token that hasn't expired
  const tokenRecord = user.refreshTokens.find(
    rt => rt.token === hashedToken && rt.expiresAt > new Date()
  );
  
  return !!tokenRecord;
};

/**
 * Revoke a specific refresh token
 * @param {Object} user - User mongoose document
 * @param {string} refreshToken - Refresh token to revoke
 */
export const revokeRefreshToken = async (user, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== hashedToken);
  await user.save();
};

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 * @param {Object} user - User mongoose document
 */
export const revokeAllRefreshTokens = async (user) => {
  user.refreshTokens = [];
  await user.save();
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
