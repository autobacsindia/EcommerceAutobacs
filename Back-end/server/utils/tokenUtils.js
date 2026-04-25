/**
 * Token Utilities
 * Cryptographic token generation and hashing for password reset and email verification
 */

import crypto from 'crypto';

/**
 * Generate a cryptographically secure random token
 * @param {number} length - Token length in bytes (default: 32)
 * @returns {string} - Hex-encoded random token
 */
export const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Hash a token using SHA-256 with server-side pepper
 * @param {string} token - Plain token to hash
 * @returns {string} - Hashed token
 */
export const hashToken = (token) => {
  // Add pepper (server-side secret) for additional security
  const pepper = process.env.RESET_TOKEN_SECRET || 'default-pepper-change-in-production';
  return crypto.createHash('sha256').update(token + pepper).digest('hex');
};

/**
 * Generate token and its hash
 * @param {number} length - Token length in bytes (default: 32)
 * @returns {Object} - { token, hashedToken }
 */
export const generateTokenPair = (length = 32) => {
  const token = generateToken(length);
  const hashedToken = hashToken(token);
  return { token, hashedToken };
};
