/**
 * JWT Secret Management with Rotation Support
 * 
 * Supports zero-downtime secret rotation using versioned secrets with Key IDs (kid).
 * This allows rotating JWT_SECRET without forcing all users to logout.
 * 
 * Industry Standard: Uses `kid` header to identify which secret was used,
 * avoiding brute-force secret attempts during verification.
 * 
 * Usage:
 * - Set JWT_SECRET (current secret, kid='current')
 * - Set JWT_SECRET_V1 (old secret, kid='v1') during rotation
 * - System uses kid header to select correct secret
 * - After all tokens reissued, remove JWT_SECRET_V1
 * 
 * Rotation Window: Keep old secret for (max token TTL + buffer)
 * - Access token: 15-30 min
 * - Refresh token: 7-30 days
 * - Recommended rotation window: 8 days (for 7-day refresh tokens)
 */

import jwt from 'jsonwebtoken';

// Security: Limit maximum active secrets to prevent misuse
const MAX_SECRETS = 2;

/**
 * Secret key store with Key IDs (kid)
 * Maps kid -> secret for fast lookup
 * 
 * Key Naming Strategy:
 * - 'current' - Primary active secret
 * - 'v1', 'v2' - Legacy versioned secrets (during rotation)
 * - '2026-04-22' - Date-based naming (alternative, for audit trails)
 * 
 * Best Practice: Use date-based naming for clear audit history
 */
const getKeyStore = () => {
  const keyStore = {};
  
  // Primary secret (kid='current')
  if (process.env.JWT_SECRET) {
    keyStore['current'] = process.env.JWT_SECRET;
  }
  
  // Versioned secrets for rotation
  // Supports both 'v1', 'v2' format AND date-based format
  const versionKeys = Object.keys(process.env)
    .filter(key => key.startsWith('JWT_SECRET_V') || key.startsWith('JWT_SECRET_20'));
  
  for (const key of versionKeys) {
    const kid = key.replace('JWT_SECRET_', '').toLowerCase();
    keyStore[kid] = process.env[key];
  }
  
  // Security: Prevent unlimited secret growth
  if (Object.keys(keyStore).length > MAX_SECRETS) {
    console.error(`[Security] ✗ Too many active JWT secrets: ${Object.keys(keyStore).length} (max: ${MAX_SECRETS})`);
    console.error('[Security] Remove old secrets to continue');
    console.error('[Security] Active secrets:', Object.keys(keyStore).join(', '));
    throw new Error('Too many active JWT secrets');
  }
  
  return keyStore;
};

/**
 * Get active secrets in priority order (for backward compatibility)
 * @deprecated Use getKeyStore() instead for kid-based verification
 */
export const getActiveSecrets = () => {
  const keyStore = getKeyStore();
  return Object.entries(keyStore).map(([kid, secret]) => ({
    secret,
    version: kid
  }));
};

/**
 * Get the primary secret and its kid
 * Used for signing new tokens
 */
export const getPrimarySecret = () => {
  const keyStore = getKeyStore();
  
  if (Object.keys(keyStore).length === 0) {
    throw new Error('No JWT secrets configured');
  }
  
  // Primary is always 'current'
  return {
    secret: keyStore['current'] || Object.values(keyStore)[0],
    kid: keyStore['current'] ? 'current' : Object.keys(keyStore)[0]
  };
};

/**
 * Sign JWT token with primary secret and kid header
 * Always uses the primary (current) secret for new tokens
 * 
 * @param {Object} payload - Token payload
 * @param {Object} options - JWT signing options
 * @returns {string} - Signed JWT token with kid header
 */
export const signToken = (payload, options = {}) => {
  const { secret, kid } = getPrimarySecret();
  
  // Add kid to JWT header for fast verification
  const tokenOptions = {
    ...options,
    header: {
      ...options.header,
      kid: kid  // Key ID identifies which secret was used
    }
  };
  
  return jwt.sign(payload, secret, tokenOptions);
};

/**
 * Verify JWT token with kid-based secret selection
 * Uses kid header to select correct secret (no brute-force attempts)
 * 
 * Security Notes:
 * - jwt.decode() does NOT verify signature (header is untrusted)
 * - We validate kid against known keyStore before verification
 * - Algorithm is locked to ['HS256'] to prevent algorithm confusion attacks
 * 
 * @param {string} token - JWT token to verify
 * @param {Object} options - JWT verification options
 * @returns {Object} - Decoded token payload
 * @throws {Error} - If token is invalid or kid not found
 */
export const verifyTokenWithRotation = (token, options = {}) => {
  const keyStore = getKeyStore();
  
  if (Object.keys(keyStore).length === 0) {
    throw new Error('No JWT secrets configured');
  }
  
  const defaultOptions = {
    algorithms: ['HS256'],  // CRITICAL: Prevent algorithm confusion attacks
    ...options
  };
  
  try {
    // Decode token to extract kid header (WITHOUT verification)
    // WARNING: Header is untrusted input at this point
    const decodedHeader = jwt.decode(token, { complete: true });
    
    if (!decodedHeader || !decodedHeader.header) {
      throw new Error('Invalid token format');
    }
    
    const kid = decodedHeader.header.kid || 'current'; // Default to 'current' for legacy tokens
    
    // SECURITY: Validate kid against known keys BEFORE using it
    // Never trust kid from untrusted header without validation
    const secret = keyStore[kid];
    
    if (!secret) {
      // Log potential security issue
      console.error(`[Security] ✗ Unknown kid in token: ${kid}`);
      console.error('[Security] Token rejected - possible attack or misconfiguration');
      throw new Error('Invalid token: unknown key identifier');
    }
    
    // Verify with correct secret (fast, no brute-force)
    // Algorithm is locked to HS256 to prevent algorithm confusion attacks
    const decoded = jwt.verify(token, secret, defaultOptions);
    
    // Monitor fallback key usage (for rotation metrics)
    if (kid !== 'current' && process.env.NODE_ENV !== 'test') {
      console.warn(`[Auth] ⚠ Using fallback key (kid=${kid}), rotation in progress`);
      console.warn(`[Auth] Fallback key usage should decrease over time`);
    }
    
    return decoded;
  } catch (err) {
    // Provide clear error messages for debugging
    if (err.message.includes('unknown key')) {
      throw err;  // Already logged above
    }
    if (err.name === 'JsonWebTokenError') {
      throw new Error('Invalid token: signature verification failed');
    }
    if (err.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    throw new Error('Invalid token');
  }
};

/**
 * Get rotation status for monitoring and audit
 * @returns {Object} - Rotation status information
 */
export const getRotationStatus = () => {
  const keyStore = getKeyStore();
  const secretCount = Object.keys(keyStore).length;
  
  const status = {
    isActive: secretCount > 1,
    secretCount,
    versions: Object.keys(keyStore),
    primaryVersion: keyStore['current'] ? 'current' : Object.keys(keyStore)[0],
    maxAllowed: MAX_SECRETS,
    recommendation: secretCount > 1 
      ? `Rotation in progress - remove old secrets after ${getRotationWindowDays()} days`
      : 'No active rotation'
  };
  
  // Audit log (only when rotation is active)
  if (status.isActive && process.env.NODE_ENV !== 'test') {
    console.log('[Security] JWT secret rotation active', {
      active: status.primaryVersion,
      fallback: status.versions.filter(v => v !== status.primaryVersion).join(', '),
      secretCount,
      recommendation: status.recommendation
    });
  }
  
  return status;
};

/**
 * Calculate recommended rotation window based on token TTL
 * @returns {number} - Days to keep old secret
 */
const getRotationWindowDays = () => {
  // Parse refresh token expiry (default 7 days)
  const refreshExpire = process.env.REFRESH_TOKEN_EXPIRE || '7d';
  const match = refreshExpire.match(/^(\d+)([dhs])$/);
  
  if (!match) return 8; // Default buffer
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  let days;
  switch (unit) {
    case 'd': days = value; break;
    case 'h': days = value / 24; break;
    case 's': days = value / 86400; break;
    default: days = 7;
  }
  
  // Add 1 day buffer
  return Math.ceil(days) + 1;
};
