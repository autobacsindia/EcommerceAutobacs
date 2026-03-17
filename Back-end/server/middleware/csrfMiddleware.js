import crypto from 'crypto';

/**
 * CSRF Protection Middleware
 * Implements Double-Submit Cookie Pattern
 * 
 * 1. Sets a non-httpOnly cookie (XSRF-TOKEN) with a random token
 * 2. Requires state-changing requests (POST, PUT, DELETE, PATCH) to have:
 *    - A matching X-XSRF-TOKEN header
 *    OR
 *    - A valid Authorization header (Bearer token) - assuming API usage
 *    
 * This ensures that cookie-based authentication (like /auth/refresh) is protected against CSRF.
 */

export const csrfProtection = (req, res, next) => {
  // 1. Generate and set CSRF token cookie if not present
  // This is a non-httpOnly cookie that the frontend can read
  if (!req.cookies['XSRF-TOKEN']) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', token, {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      httpOnly: false, // Must be readable by frontend JS
      path: '/'
    });
    // If it's a GET request, we're done (just setting the cookie)
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
  }

  // 2. Check for exemption
  // If the request uses Bearer token auth, it's generally CSRF-safe (browser doesn't send it automatically)
  // But for extra security, we can enforce it everywhere. 
  // For now, we enforce it if cookies are used for auth (like refresh token)
  
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip for public auth endpoints (Login, Register, etc.)
  // These don't rely on existing cookies for authorization, so CSRF is less of a concern
  // (though Login CSRF is a theoretical vector, it's low risk here)
  const excludedPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/google',
    '/auth/facebook',
    '/auth/google/callback',
    '/auth/facebook/callback',
    '/api/delivery-zones/check-serviceability',
    '/api/delivery-zones/estimate',
    '/api/delivery-zones/shipping-cost',
    '/api/location/select',
    '/location/select',
    '/consultation',   // public lead-capture, no cookie auth
    '/contact',        // public contact form, no cookie auth
  ];

  if (excludedPaths.some(path => req.path.includes(path))) {
    return next();
  }

  // 3. Verify Token
  const expectedToken = req.cookies['XSRF-TOKEN'];
  const actualToken = req.headers['x-xsrf-token'];

  // If no token in cookie yet (first request), or mismatch
  if (!expectedToken || !actualToken || expectedToken !== actualToken) {
    // Exception: If valid Bearer token is present, we might allow it (stateless API style)
    // However, if the endpoint relies on cookies (like /refresh), we MUST block it.
    
    // Check if the request is for the refresh endpoint which uses cookies
    const isCookieAuthEndpoint = req.path.includes('/auth/refresh') || req.path.includes('/auth/logout');
    
    if (isCookieAuthEndpoint) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token missing or invalid'
      });
    }

    // For other endpoints, if they have Bearer token, they are safe
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      return next();
    }

    // Default block
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing or invalid'
    });
  }

  next();
};

export default csrfProtection;
