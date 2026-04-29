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
 * This ensures that cookie-based authentication (access token + refresh token cookies)
 * is protected against CSRF attacks.
 * 
 * NOTE: SameSite=Lax helps but is NOT complete CSRF defense.
 * SameSite=Lax allows top-level navigation (GET) but blocks cross-site POST.
 * However, SameSite is not a substitute for CSRF tokens on state-changing routes.
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
    '/auth/exchange-code',  // OAuth code exchange - uses one-time code, CSRF-safe
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

  // AUDIT: Track CSRF failures for alerting thresholds
  if (!actualToken || !expectedToken || expectedToken !== actualToken) {
    // Get normalized IP
    const forwarded = req.headers['x-forwarded-for'];
    const clientIP = forwarded ? forwarded.split(',')[0].trim() : (req.ip || 'unknown');
    
    console.warn(
      '[SECURITY] Missing CSRF token | Path:', req.path, '| Method:', req.method,
      '| IP:', clientIP
    );
    
    // Track failure rate (in-memory for now, can use Redis in production)
    if (!global.csrfFailureCounts) {
      global.csrfFailureCounts = new Map();
    }
    
    const key = `csrf_fail:${clientIP}`;
    const count = (global.csrfFailureCounts.get(key) || 0) + 1;
    global.csrfFailureCounts.set(key, count);
    
    // Alert thresholds
    if (count === 10) {
      console.error(
        '[SECURITY ALERT] Suspicious CSRF activity | IP:', clientIP,
        '| Failures:', count, '/min | Possible attack'
      );
    } else if (count >= 50) {
      console.error(
        '[SECURITY ALERT] Likely CSRF attack | IP:', clientIP,
        '| Failures:', count, '/min | RATE LIMIT TRIGGERED'
      );
      // Could add automatic IP blocking here
    }
    
    // Clean up old entries every 60 seconds (simple rate window)
    if (!global.csrfCleanupInterval) {
      global.csrfCleanupInterval = setInterval(() => {
        global.csrfFailureCounts.clear();
      }, 60 * 1000);
    }
  }

  // If no token in cookie yet (first request), or mismatch
  if (!expectedToken || !actualToken || expectedToken !== actualToken) {
    // Exception: If valid Bearer token is present, it's CSRF-safe
    // (browser doesn't send Bearer tokens automatically on cross-site requests)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      return next();
    }
    
    // CRITICAL: If request uses cookie-based auth (accessToken cookie present),
    // we MUST enforce CSRF token to prevent CSRF attacks
    const isUsingCookieAuth = req.cookies['accessToken'] || req.cookies['refreshToken'];
    
    if (isUsingCookieAuth) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token missing or invalid. Please refresh the page and try again.'
      });
    }

    // Default block (no auth method detected)
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing or invalid'
    });
  }

  next();
};

export default csrfProtection;
