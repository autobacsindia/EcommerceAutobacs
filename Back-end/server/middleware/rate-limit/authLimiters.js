import { rateLimit } from './core.js';

export const authenticationRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts. Please wait before trying again.',
  keyGenerator: (req) => `rate_limit:auth:${req.ip}:${req.body?.email || ''}`
});

export const registerRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX) || 5,
  message: 'Too many registration attempts, please try again later',
  keyGenerator: (req) => `rate_limit:register:${req.ip || req.connection.remoteAddress}`
});

export const loginRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  message: 'Too many login attempts, please try again later',
  keyGenerator: (req) => `rate_limit:login:${req.ip || req.connection.remoteAddress}`
});

export const failedLoginRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: parseInt(process.env.FAILED_LOGIN_RATE_LIMIT_MAX) || 5,
  message: 'Too many failed login attempts, account temporarily locked',
  keyGenerator: (req) => `rate_limit:failed_login:${req.ip || req.connection.remoteAddress}:${req.body.email || ''}`
});

export const refreshTokenRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many token refresh attempts. Please wait before trying again.',
  keyGenerator: (req) => `rate_limit:refresh:${req.ip || req.connection.remoteAddress}`
});

export const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many password reset requests. Please try again later',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const email = req.body.email || 'unknown';
    return `rate_limit:forgot_password:${ip}:${email}`;
  }
});

export const resetPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password reset attempts. Please try again later',
  keyGenerator: (req) => `rate_limit:reset_password:${req.ip || req.connection.remoteAddress}`
});

export const resendVerificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many verification email requests. Please wait before requesting again',
  keyGenerator: (req) => {
    const email = req.body?.email || req.user?.email || '';
    return `rate_limit:resend_verification:${req.ip || req.connection.remoteAddress}:${email}`;
  }
});

export const verifyEmailRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: 'Too many verification attempts. Please try again later',
  keyGenerator: (req) => `rate_limit:verify_email:${req.ip || req.connection.remoteAddress}`
});

// Deprecated — kept for backward compatibility
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again later'
});
