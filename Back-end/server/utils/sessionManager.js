/**
 * Session Management & Refresh Token Utility
 * Handles refresh token generation, rotation, and revocation
 * Integrated with Redis for distributed session management
 */

import crypto from 'crypto';
import sessionStore from '../services/sessionStore.js';
import { signToken } from './jwtSecretManager.js';
import User from '../models/User.js';
import { buildCookieOptions } from './cookieOptions.js';

// Grace window (seconds) during which a just-rotated refresh token can be
// replayed by a concurrent/lagging request and still resolve to its successor,
// instead of triggering reuse detection. Kept short (theft replays outside this
// window are still caught). Tunable via env for prod.
const ROTATION_GRACE_SECONDS = Number(process.env.REFRESH_ROTATION_GRACE_SECONDS) || 30;

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
  
  // CRITICAL: Include sessionVersion in JWT for instant revocation
  // When user.sessionVersion increments, all old tokens become invalid
  const accessToken = signToken(
    { 
      id: user._id, 
      role: user.role,
      sessionVersion: user.sessionVersion || 0 // ✅ Version embedded in token
    },
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
 * Validate and verify refresh token (Redis fast path → MongoDB source of truth).
 *
 * Previous logic had a critical flaw: a Redis cache miss (false) caused an early
 * return before MongoDB was ever checked, making the rehydration code unreachable
 * and causing mass 401s after any Redis restart or TTL expiry.
 *
 * Correct flow:
 *   1. Redis hit  → slide TTL, return true immediately.
 *   2. Redis miss → check MongoDB.
 *      a. Not in MongoDB  → token is genuinely invalid, return false.
 *      b. Found in MongoDB → rehydrate Redis, return true.
 *   3. Redis error → log, fall through to MongoDB (never fail-closed on infra).
 */
export const validateRefreshToken = async (user, refreshToken) => {
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // ── Step 1: Redis fast path ───────────────────────────────────────────────
  let redisHit = false;
  try {
    redisHit = await sessionStore.validateSession(user._id.toString(), hashedToken);
    if (redisHit) {
      // Sliding expiration: reset TTL on every valid use
      await sessionStore.refreshSessionTTL(
        user._id.toString(),
        hashedToken,
        30 * 24 * 60 * 60,
      );
      return true;
    }
    // redisHit === false: cache miss (not an error) — fall through to MongoDB
  } catch (err) {
    // Redis connectivity issue — log and fall through; never block auth on infra
    console.error('[Session] Redis validation error, falling back to MongoDB:', err.message);
  }

  // ── Step 2: MongoDB source of truth ──────────────────────────────────────
  const tokenRecord = user.refreshTokens.find(
    (rt) => rt.token === hashedToken && rt.expiresAt > new Date(),
  );

  if (!tokenRecord) return false; // Genuinely invalid / expired

  // ── Step 3: Rehydrate Redis (cache miss recovery, stampede-protected) ─────
  const lockKey = `lock:rehydrate:${user._id}:${hashedToken}`;
  try {
    const lockToken = await sessionStore.acquireLock(lockKey, 5);

    if (lockToken) {
      try {
        // Double-check: another concurrent request may have already rehydrated
        const alreadyBack = await sessionStore.validateSession(user._id.toString(), hashedToken);
        if (!alreadyBack) {
          const ttlSeconds = Math.floor((tokenRecord.expiresAt - new Date()) / 1000);
          await sessionStore.storeSession(
            user._id.toString(),
            hashedToken,
            { ipAddress: tokenRecord.ipAddress, deviceInfo: tokenRecord.deviceInfo },
            ttlSeconds,
          );
          console.log(`[Session] Rehydrated Redis for user ${user._id}`);
        }
      } finally {
        await sessionStore.releaseLock(lockKey, lockToken);
      }
    } else {
      // Another request holds the rehydration lock — brief wait then continue
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (rehydrateErr) {
    // Non-fatal: MongoDB already confirmed the token is valid
    console.error('[Session] Redis rehydration failed:', rehydrateErr.message);
  }

  return true;
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
 * DETECTS TOKEN REUSE: If old token was already revoked, this is a reuse attack
 * @param {Object} user - User mongoose document
 * @param {string} oldRefreshToken - Old refresh token to revoke
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 * @returns {Object} - New token pair
 * @throws {Error} - If token reuse is detected
 */
export const rotateRefreshToken = async (user, oldRefreshToken, ipAddress = null, userAgent = null) => {
  const hashedToken = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');
  
  // SECURITY CHECK: Verify the old token exists before revoking
  // If it doesn't exist, it was already revoked → TOKEN REUSE ATTACK!
  const tokenExists = user.refreshTokens.some(rt => rt.token === hashedToken);

  if (!tokenExists) {
    // The token is not in the active set. Before assuming theft, check whether
    // it was simply rotated moments ago by a concurrent request (browser fires
    // the Edge-middleware refresh and in-flight API 401s with the same cookie).
    // If a successor is still within the grace window, this is a benign race:
    // hand back the same successor rather than nuking the user's sessions.
    const grace = await sessionStore.getRotationGrace(hashedToken);
    if (grace) {
      return grace;
    }

    // TOKEN REUSE DETECTED (outside the grace window)!
    // Someone is trying to use a long-since-revoked refresh token.
    console.error(
      `[SECURITY] Refresh token reuse detected! | User: ${user.email} | IP: ${ipAddress} | ` +
      `UA: ${userAgent}`
    );

    // NUCLEAR OPTION: Revoke ALL sessions for this user
    await revokeAllRefreshTokens(user);

    // Throw error to be caught by auth route handler
    throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
  }

  // Normal rotation: revoke old token, generate new one
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

  // Cache the successor under the OLD token's hash so concurrent/lagging
  // refresh requests carrying the old token coalesce onto this same result
  // (idempotent rotation) instead of racing into a 401 / reuse wipe.
  await sessionStore.storeRotationGrace(hashedToken, tokens, ROTATION_GRACE_SECONDS);

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
  const now = new Date();
  const update = {
    $push: {
      loginAttempts: {
        $each: [{ timestamp: now, ipAddress, success, userAgent }],
        $slice: -50,
      },
    },
  };
  if (success) {
    update.$set = { lastLoginAt: now, lastLoginIp: ipAddress };
  }
  await User.updateOne({ _id: user._id }, update);
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
 * Set access token cookie on response
 * @param {Object} res - Express response object
 * @param {string} token - Access token
 * @param {string|number} expiresIn - Token expiry (e.g., '30m' or 1800)
 */
export const setAccessTokenCookie = (res, token, expiresIn) => {
  // Parse expiry time to milliseconds
  let maxAge;
  if (typeof expiresIn === 'string') {
    // Parse '30m', '15m', '1h', etc.
    const match = expiresIn.match(/^(\d+)([mhd])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      maxAge = value * (unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400) * 1000;
    } else {
      maxAge = 30 * 60 * 1000; // Default: 30 minutes
    }
  } else if (typeof expiresIn === 'number') {
    maxAge = expiresIn * 1000; // Convert seconds to ms
  } else {
    maxAge = 30 * 60 * 1000; // Default: 30 minutes
  }
  
  const cookieOptions = buildCookieOptions({
    httpOnly: true,
    maxAge: maxAge,
    priority: 'high',
  });

  res.cookie('accessToken', token, cookieOptions);
};

/**
 * Clear access token cookie on response
 * @param {Object} res - Express response object
 */
export const clearAccessTokenCookie = (res) => {
  res.clearCookie('accessToken', buildCookieOptions({
    httpOnly: true,
    priority: 'high',
  }));
};

/**
 * Set refresh token cookie on response
 * @param {Object} res - Express response object
 * @param {string} token - Refresh token
 * @param {Date} expiresAt - Expiration date
 */
export const setRefreshTokenCookie = (res, token, expiresAt) => {
  const cookieOptions = buildCookieOptions({
    httpOnly: true,
    expires: expiresAt,
    priority: 'high',
  });

  res.cookie('refreshToken', token, cookieOptions);
};

/**
 * Clear refresh token cookie on response
 * @param {Object} res - Express response object
 */
export const clearRefreshTokenCookie = (res) => {
  const cookieOptions = buildCookieOptions({
    httpOnly: true,
    priority: 'high',
  });

  res.clearCookie('refreshToken', cookieOptions);
};
