import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';

// Cache for introspection results (10 second TTL)
const introspectionCache = new Map();
const CACHE_TTL = 10000; // 10 seconds

/**
 * Introspect a JWT token and return detailed validation information
 * @param {string} token - The token to introspect
 * @param {string} tokenTypeHint - 'access_token' or 'refresh_token'
 * @returns {Object} Introspection result
 */
export const introspectToken = async (token, tokenTypeHint = 'access_token') => {
  try {
    // Check cache first
    const cacheKey = `${tokenTypeHint}:${crypto.createHash('sha256').update(token).digest('hex')}`;
    const cached = introspectionCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }
    
    let decoded;
    let signatureValid = false;
    let user;
    let sessionInfo = null;
    
    // Step 1: Verify JWT signature and decode
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      signatureValid = true;
    } catch (err) {
      // Token invalid or expired
      const result = {
        success: false,
        active: false,
        reason: err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_signature',
        error: err.message
      };
      
      // Don't cache negative results
      return result;
    }
    
    // Step 2: Check if user exists
    try {
      user = await User.findById(decoded.id).select('-passwordHash');
      
      if (!user) {
        return {
          success: false,
          active: false,
          reason: 'user_not_found',
          user_id: decoded.id
        };
      }
    } catch (err) {
      return {
        success: false,
        active: false,
        reason: 'database_error',
        error: err.message
      };
    }
    
    // Step 3: For refresh tokens, check if it's in the user's refresh token list
    let refreshTokenValid = true;
    if (tokenTypeHint === 'refresh_token') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const refreshToken = user.refreshTokens.find(rt => rt.token === tokenHash);
      
      if (!refreshToken) {
        return {
          success: false,
          active: false,
          reason: 'token_revoked',
          revoked_at: new Date().toISOString(),
          revocation_reason: 'Token not found in user session list'
        };
      }
      
      if (new Date() > refreshToken.expiresAt) {
        return {
          success: false,
          active: false,
          reason: 'token_expired',
          expired_at: refreshToken.expiresAt.toISOString()
        };
      }
      
      sessionInfo = {
        device_info: refreshToken.deviceInfo,
        ip_address: refreshToken.ipAddress,
        created_at: refreshToken.createdAt.toISOString(),
        expires_at: refreshToken.expiresAt.toISOString()
      };
    }
    
    // Step 4: Check role matches
    const roleMatches = decoded.role === user.role;
    
    // Step 5: Calculate token expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = decoded.exp - now;
    const notExpired = expiresIn > 0;
    
    // Step 6: Build comprehensive introspection result
    const result = {
      success: true,
      active: signatureValid && notExpired && !!user && roleMatches && refreshTokenValid,
      token_type: tokenTypeHint,
      scope: decoded.role,
      client_id: 'web_app', // Could be extended for multiple clients
      user_id: decoded.id,
      username: user.email,
      exp: decoded.exp,
      iat: decoded.iat,
      jti: decoded.jti || null,
      validation_details: {
        signature_valid: signatureValid,
        not_expired: notExpired,
        not_revoked: refreshTokenValid,
        user_exists: !!user,
        role_matches: roleMatches,
        session_active: tokenTypeHint === 'refresh_token' ? !!sessionInfo : true
      },
      user_context: {
        name: user.name,
        email: user.email,
        role: user.role,
        account_status: user.isVerified ? 'active' : 'pending_verification',
        last_login: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        created_at: user.createdAt.toISOString()
      },
      ...(sessionInfo && { session_context: sessionInfo })
    };
    
    // Cache positive results only
    if (result.active) {
      introspectionCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });
      
      // Cleanup old cache entries
      cleanupCache();
    }
    
    return result;
    
  } catch (error) {
    console.error('Token introspection error:', error);
    return {
      success: false,
      active: false,
      reason: 'introspection_error',
      error: error.message
    };
  }
};

/**
 * Batch introspect multiple tokens (for bulk operations)
 * @param {Array} tokens - Array of {token, tokenTypeHint} objects
 * @returns {Array} Array of introspection results
 */
export const batchIntrospectTokens = async (tokens) => {
  const results = await Promise.all(
    tokens.map(({ token, tokenTypeHint }) => introspectToken(token, tokenTypeHint))
  );
  
  return results;
};

/**
 * Get all active sessions for a user
 * @param {string} userId - User ID
 * @returns {Object} User session information
 */
export const getUserSessions = async (userId) => {
  try {
    const user = await User.findById(userId).select('refreshTokens lastLoginAt lastLoginIp');
    
    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    const now = new Date();
    const activeSessions = user.refreshTokens
      .filter(rt => rt.expiresAt > now)
      .map(rt => ({
        created_at: rt.createdAt.toISOString(),
        expires_at: rt.expiresAt.toISOString(),
        device_info: rt.deviceInfo,
        ip_address: rt.ipAddress,
        days_until_expiry: Math.ceil((rt.expiresAt - now) / (1000 * 60 * 60 * 24))
      }));
    
    return {
      success: true,
      user_id: userId,
      session_count: activeSessions.length,
      sessions: activeSessions,
      last_login: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      last_login_ip: user.lastLoginIp
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'Error retrieving user sessions',
      error: error.message
    };
  }
};

/**
 * Revoke a specific token
 * @param {string} token - Token to revoke
 * @param {string} userId - User ID
 * @returns {Object} Revocation result
 */
export const revokeToken = async (token, userId) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const user = await User.findById(userId);
    if (!user) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    // Remove the token from refreshTokens array
    user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== tokenHash);
    await user.save();
    
    return {
      success: true,
      message: 'Token revoked successfully'
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'Error revoking token',
      error: error.message
    };
  }
};

/**
 * Cleanup expired cache entries
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of introspectionCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      introspectionCache.delete(key);
    }
  }
}

// Periodic cache cleanup (every minute)
setInterval(cleanupCache, 60000);

export default {
  introspectToken,
  batchIntrospectTokens,
  getUserSessions,
  revokeToken
};
