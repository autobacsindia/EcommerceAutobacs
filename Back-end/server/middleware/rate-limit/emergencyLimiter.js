const emergencyStore = new Map();
const EMERGENCY_WINDOW_MS = 1000;
const EMERGENCY_MAX_REQUESTS = 10;

const CRITICAL_ROUTES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/checkout',
  '/api/v1/payment',
  '/api/v1/orders',
  '/api/v1/users',
  '/api/v1/admin'
];

export function isCriticalRoute(req) {
  const path = req.originalUrl || req.url;
  return CRITICAL_ROUTES.some(route => path.startsWith(route));
}

export function applyLocalEmergencyLimit(req, res, next) {
  const key = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = emergencyStore.get(key) || { count: 0, reset: now + EMERGENCY_WINDOW_MS };

  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + EMERGENCY_WINDOW_MS;
  }

  entry.count++;
  emergencyStore.set(key, entry);

  if (entry.count > EMERGENCY_MAX_REQUESTS) {
    console.warn(`[RateLimit] Emergency limit exceeded for IP: ${key}`);
    res.set('Retry-After', '1');
    return res.status(429).json({
      success: false,
      message: 'Too many requests (temporary protection during service recovery)',
      code: 'EMERGENCY_RATE_LIMIT',
      retryAfter: 1
    });
  }

  next();
}

export function handleRedisUnavailable(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    if (isCriticalRoute(req)) {
      console.error(`[RateLimit] ❌ Redis unavailable - rejecting critical route: ${req.path}`);
      res.set('Retry-After', '5');
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please try again in a moment.',
        code: 'RATE_LIMIT_SERVICE_DOWN',
        retryAfter: 5
      });
    } else {
      console.warn(`[RateLimit] ⚠️ Redis unavailable - applying emergency local limit for: ${req.path}`);
      return applyLocalEmergencyLimit(req, res, next);
    }
  } else {
    console.warn('[RateLimit] ⚠️ Redis unavailable - allowing request (development fallback)');
    return next();
  }
}
