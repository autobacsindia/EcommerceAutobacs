/**
 * Session Keep-Alive Middleware
 * Automatically refreshes access tokens during checkout to prevent mid-payment timeouts
 * This ensures users don't lose their session while completing sensitive operations
 */

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { generateTokenPair, storeRefreshToken } from '../utils/sessionManager.js';

/**
 * Middleware to refresh access token if it's close to expiration during checkout
 * Only applies to authenticated routes during checkout/payment flows
 * 
 * @param {number} minutesBeforeExpiry - Minutes before token expiry to trigger refresh (default: 5)
 */
export const sessionKeepAlive = (minutesBeforeExpiry = 5) => {
  return async (req, res, next) => {
    try {
      // Check if Authorization header exists
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
      }

      const token = authHeader.substring(7);

      // Decode token without verification to check expiry
      const decoded = jwt.decode(token);
      
      if (!decoded || !decoded.exp) {
        return next();
      }

      // Calculate time until expiration
      const expiresAt = decoded.exp * 1000; // Convert to milliseconds
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;
      const thresholdMs = minutesBeforeExpiry * 60 * 1000;

      // If token is expiring soon, issue a new one
      if (timeUntilExpiry > 0 && timeUntilExpiry < thresholdMs) {
        const user = await User.findById(decoded.id);
        
        if (!user) {
          return next();
        }

        // Generate new token pair
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const tokens = generateTokenPair(user, ipAddress, userAgent);

        // Store new refresh token (if not already stored)
        await storeRefreshToken(
          user,
          tokens.refreshToken,
          tokens.refreshTokenExpiry,
          ipAddress,
          userAgent
        );

        // Send new tokens in response headers
        res.set('X-Token-Refreshed', 'true');
        res.set('X-Access-Token', tokens.accessToken);
        res.set('X-Refresh-Token', tokens.refreshToken);

        console.log(`[Session Keep-Alive] Token refreshed for user ${user.email} during checkout`);
      }

      next();
    } catch (error) {
      // Log error but don't block the request
      console.error('[Session Keep-Alive] Error:', error);
      next();
    }
  };
};

/**
 * Middleware specifically for checkout routes
 * Refreshes token 10 minutes before expiration (more aggressive)
 */
export const checkoutSessionKeepAlive = sessionKeepAlive(10);

/**
 * Middleware for payment routes
 * Refreshes token 15 minutes before expiration (most aggressive)
 */
export const paymentSessionKeepAlive = sessionKeepAlive(15);

/**
 * Response interceptor to notify frontend about token refresh
 * Frontend should update stored tokens when X-Token-Refreshed header is present
 */
export const attachTokenRefreshInfo = (req, res, next) => {
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    // If token was refreshed, add info to response body
    if (res.get('X-Token-Refreshed') === 'true') {
      data.tokenRefreshed = true;
      data.newAccessToken = res.get('X-Access-Token');
      data.newRefreshToken = res.get('X-Refresh-Token');
      
      // Remove from headers (already in body)
      res.removeHeader('X-Access-Token');
      res.removeHeader('X-Refresh-Token');
    }
    
    return originalJson(data);
  };
  
  next();
};

export default {
  sessionKeepAlive,
  checkoutSessionKeepAlive,
  paymentSessionKeepAlive,
  attachTokenRefreshInfo
};
