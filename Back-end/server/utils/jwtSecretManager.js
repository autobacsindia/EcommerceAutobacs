/**
 * JWT Secret Management with Rotation Support
 * 
 * Supports zero-downtime secret rotation using versioned secrets.
 * This allows rotating JWT_SECRET without forcing all users to logout.
 * 
 * Usage:
 * - Set JWT_SECRET_V1 (old secret)
 * - Set JWT_SECRET_V2 (new secret, primary)
 * - System tries V2 first, falls back to V1
 * - After all tokens reissued, remove V1
 */

import jwt from 'jsonwebtoken';

/**
 * Get all active JWT secrets in priority order
 * Returns array of [secret, version] pairs
 */
export const getActiveSecrets = () => {
  const secrets = [];
  
  // Primary secret (highest priority)
  if (process.env.JWT_SECRET) {
    secrets.push({ secret: process.env.JWT_SECRET, version: 'current' });
  }
  
  // Versioned secrets for rotation
  if (process.env.JWT_SECRET_V2) {
    secrets.push({ secret: process.env.JWT_SECRET_V2, version: 'v2' });
  }
  
  if (process.env.JWT_SECRET_V1) {
    secrets.push({ secret: process.env.JWT_SECRET_V1, version: 'v1' });
  }
  
  // Remove duplicates (keep first occurrence)
  const seen = new Set();
  return secrets.filter(({ secret }) => {
    if (seen.has(secret)) return false;
    seen.add(secret);
    return true;
  });
};

/**
 * Verify JWT token with secret rotation support
 * Tries each secret in order until one succeeds
 * 
 * @param {string} token - JWT token to verify
 * @param {Object} options - JWT verification options
 * @returns {Object} - Decoded token payload
 * @throws {Error} - If token is invalid for all secrets
 */
export const verifyTokenWithRotation = (token, options = {}) => {
  const secrets = getActiveSecrets();
  
  if (secrets.length === 0) {
    throw new Error('No JWT secrets configured');
  }
  
  const defaultOptions = {
    algorithms: ['HS256'],
    ...options
  };
  
  // Try each secret in order
  for (const { secret, version } of secrets) {
    try {
      const decoded = jwt.verify(token, secret, defaultOptions);
      
      // Log which secret version was used (for monitoring)
      if (version !== 'current' && process.env.NODE_ENV !== 'test') {
        console.warn(`[JWT] Token verified with ${version} secret (rotation in progress)`);
      }
      
      return decoded;
    } catch (err) {
      // Try next secret
      continue;
    }
  }
  
  // All secrets failed
  throw new Error('Invalid token');
};

/**
 * Sign JWT token with primary secret
 * Always uses the primary (current) secret for new tokens
 * 
 * @param {Object} payload - Token payload
 * @param {Object} options - JWT signing options
 * @returns {string} - Signed JWT token
 */
export const signToken = (payload, options = {}) => {
  const secrets = getActiveSecrets();
  
  if (secrets.length === 0) {
    throw new Error('No JWT secrets configured');
  }
  
  // Always use the first (primary) secret
  const primarySecret = secrets[0].secret;
  
  return jwt.sign(payload, primarySecret, options);
};

/**
 * Get rotation status for monitoring
 * @returns {Object} - Rotation status information
 */
export const getRotationStatus = () => {
  const secrets = getActiveSecrets();
  
  return {
    isActive: secrets.length > 1,
    secretCount: secrets.length,
    versions: secrets.map(s => s.version),
    primaryVersion: secrets[0]?.version || 'none',
    recommendation: secrets.length > 1 
      ? 'Rotation in progress - remove old secrets after all tokens are reissued'
      : 'No active rotation'
  };
};
