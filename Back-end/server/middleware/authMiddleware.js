import User from "../models/User.js";
import { asyncHandler } from "./errorMiddleware.js";
import * as Sentry from "@sentry/node";
import { verifyTokenWithRotation } from "../utils/jwtSecretManager.js";
import { getRedisClient } from "../services/redisClient.js";
import crypto from 'crypto';

// Protect routes - verify JWT token with rotation support
export const protect = asyncHandler(async (req, res, next) => {
  let token;

  // PRIORITY 1: Check for access token in httpOnly cookie (SECURE - XSS protected)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // PRIORITY 2: Check for token in Authorization header (backward compatibility for mobile/API clients)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }

  try {
    // Verify token with rotation support (tries all active secrets)
    const decoded = verifyTokenWithRotation(token, { algorithms: ['HS256'] });

    // Get user from token (exclude passwordHash, sessionVersion included by default)
   req.user = await User.findById(decoded.id).select('-passwordHash');

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // CRITICAL: Validate session version (instant revocation check)
    // If sessionVersion in DB > sessionVersion in JWT → token is revoked
    const tokenSessionVersion = decoded.sessionVersion || 0;
    const dbSessionVersion = req.user.sessionVersion || 0;

    if (tokenSessionVersion !== dbSessionVersion) {
      // Token is from old session (revoked by logout all / password change)
      console.warn(`[Auth] Session version mismatch | User: ${req.user._id} | Token: ${tokenSessionVersion}, DB: ${dbSessionVersion}`);
      
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.',
        code: 'SESSION_REVOKED'
      });
    }

    // CRITICAL: Check token issued time against security events
    // Prevents token replay if tokenInvalidBefore is set
    if (req.user.tokenInvalidBefore) {
      const tokenIssuedAt = decoded.iat * 1000; // Convert to milliseconds
      const invalidBefore = new Date(req.user.tokenInvalidBefore).getTime();
      
      if (tokenIssuedAt < invalidBefore) {
        console.warn(`[Auth] Token issued before security event | User: ${req.user._id} | Token IAT: ${tokenIssuedAt}, Invalid Before: ${invalidBefore}`);
        
        return res.status(401).json({
          success: false,
          message: 'Session expired due to security event. Please login again.',
          code: 'SESSION_INVALIDATED'
        });
      }
    }

    next();
  } catch (error) {
    // Only log in non-test environments to reduce test output noise
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Auth] Token verification failed:', {
        message: error.message,
        hasCookie: !!req.cookies?.accessToken,
        hasHeader: !!req.headers?.authorization,
        tokenLength: token?.length || 0
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token failed'
    });
  }
});

// Admin middleware - check if user is admin
//
// SECURITY POSTURE: admin sessions are protected by httpOnly + SameSite cookies
// and hashed, per-session refresh tokens (see utils/sessionManager.js). Device
// context (IP + UA) is used for ANOMALY DETECTION ONLY — we log/alert on a change
// but never block the request.
//
// We deliberately do NOT hard-block on User-Agent. That was both weak and an
// availability hazard:
//   - UA is not a secret: it is sent in the clear on every request and is
//     trivially replayed by anyone who already holds the session cookie, so
//     blocking on it adds ~no protection against session theft.
//   - The bound value lived in a single scalar field on the User document
//     (lastAdminUAHash) that every admin login overwrote. The same admin account
//     on a second device — or the same device after a browser auto-update —
//     was silently 401'd on every request, including the dashboard SSE stream,
//     surfacing as an endless "trying to reconnect".
//
// If enforceable device binding is ever required (e.g. for compliance), bind it
// PER SESSION: thread a session id into the access token and store the hash on
// the matching refreshTokens[] entry — never on a shared scalar field.
export const admin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Not authorized as admin'
    });
  }

  // Anomaly detection runs OFF the request hot path (fire-and-forget) so it never
  // adds latency to, or can break, a legitimate admin request. Alerts are deduped
  // per admin+device so a second logged-in device doesn't emit one alert per call.
  detectAdminContextAnomaly(req).catch((err) =>
    console.error('[SECURITY] Admin context anomaly check failed (ignored):', err.message)
  );

  next();
});

// How long to suppress duplicate context-change alerts for the same admin + device
// fingerprint. Keeps the "anomaly" signal meaningful: one alert per device per hour
// instead of one per request (the baseline is a single shared field, so a legitimate
// second device mismatches on *every* call).
const ADMIN_CTX_ALERT_TTL_SECONDS = 60 * 60;

// Best-effort, non-blocking detection of an admin request whose device context
// (User-Agent / client IP) differs from the baseline captured at login. Detect and
// alert only — never blocks (see the `admin` middleware doc for why).
async function detectAdminContextAnomaly(req) {
  const storedIPHash = req.user.lastAdminIPHash;
  const storedUAHash = req.user.lastAdminUAHash;

  // No baseline captured yet (legacy session / never logged in as admin) — nothing
  // to compare, so skip the hashing work entirely.
  if (!storedUAHash && !storedIPHash) return;

  // Use cf-connecting-ip first so the value is consistent with what login stored.
  const currentIP = req.headers['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';
  const currentUA = req.get('user-agent') || 'unknown';

  const currentIPHash = crypto.createHash('sha256').update(currentIP).digest('hex');
  const currentUAHash = crypto.createHash('sha256').update(currentUA).digest('hex');

  const uaChanged = !!storedUAHash && storedUAHash !== currentUAHash;
  const ipChanged = !!storedIPHash && storedIPHash !== currentIPHash;
  if (!uaChanged && !ipChanged) return;

  // Suppress duplicate alerts for the same admin + device fingerprint within the
  // window. Fail-open (alert) if Redis is unavailable — a rare duplicate alert is
  // preferable to a silent gap in a security signal.
  if (!(await claimAdminAnomalyAlertSlot(req.user._id, currentUAHash, currentIPHash))) return;

  console.warn(
    `[SECURITY] Admin session context change (detect-only, not blocked) | ` +
    `User: ${req.user.email} | UA changed: ${uaChanged} | IP changed: ${ipChanged} | IP: ${currentIP}`
  );
  Sentry.captureMessage('Admin session context change detected', {
    level: 'warning',
    extra: {
      userId: req.user._id,
      email: req.user.email,
      uaChanged,
      ipChanged,
      ip: currentIP
    }
  });
}

// Returns true if this call "claims" the alert slot for the admin+device in the
// current window (i.e. it's the first such mismatch we've seen) — using Redis
// SET NX EX as an atomic once-per-window gate. Fail-open on any Redis issue.
async function claimAdminAnomalyAlertSlot(userId, uaHash, ipHash) {
  const redis = getRedisClient();
  if (!redis) return true; // No Redis configured — don't suppress alerts.
  const key = `admin:ctx-alert:${userId}:${uaHash.slice(0, 16)}:${ipHash.slice(0, 16)}`;
  try {
    const result = await redis.set(key, '1', 'EX', ADMIN_CTX_ALERT_TTL_SECONDS, 'NX');
    return result === 'OK'; // 'OK' = we set it (first in window); null = already alerted.
  } catch (err) {
    console.error('[SECURITY] Admin anomaly alert dedupe failed (fail-open):', err.message);
    return true;
  }
}

// Optional auth middleware - populate req.user if token exists, but don't reject if missing
export const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  // PRIORITY 1: Check for access token in httpOnly cookie (SECURE - XSS protected)
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // PRIORITY 2: Check for token in Authorization header (backward compatibility)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // If no token, just continue without setting req.user
  if (!token) {
    return next();
  }

  try {
    // Verify token with rotation support
    const decoded = verifyTokenWithRotation(token, { algorithms: ['HS256'] });

    // Get user from token (exclude password)
    req.user = await User.findById(decoded.id).select('-passwordHash');

    // If user not found, just continue without req.user
    if (!req.user) {
      return next();
    }

    // Session version check — revoked tokens must not grant user context
    const tokenSessionVersion = decoded.sessionVersion || 0;
    const dbSessionVersion = req.user.sessionVersion || 0;
    if (tokenSessionVersion !== dbSessionVersion) {
      req.user = null;
      return next();
    }

    // tokenInvalidBefore check — tokens issued before a security event are invalid
    if (req.user.tokenInvalidBefore) {
      const tokenIssuedAt = decoded.iat * 1000;
      const invalidBefore = new Date(req.user.tokenInvalidBefore).getTime();
      if (tokenIssuedAt < invalidBefore) {
        req.user = null;
        return next();
      }
    }

    next();
  } catch (error) {
    // If token is invalid, just continue without req.user
    // Only log in non-test environments
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Invalid token in optional auth:', error.message);
    }
    next();
  }
});

