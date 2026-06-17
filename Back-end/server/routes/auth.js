import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fetch from "node-fetch";
import { getRedisClient } from "../services/redisClient.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateRegister, 
  validateLogin, 
  validateForgotPassword,
  validateResetPassword,
  validateTokenQuery,
  validateRefreshTokenInput,
  validateResendVerification
} from "../middleware/validationMiddleware.js";
import { 
  registerRateLimit, 
  loginRateLimit, 
  failedLoginRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  resendVerificationRateLimit,
  verifyEmailRateLimit,
  refreshTokenRateLimit
} from "../middleware/rateLimitMiddleware.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { generateTokenPair as generateCryptoTokenPair, hashToken } from "../utils/tokenUtils.js";
import { passwordResetEmail, emailVerificationEmail, passwordChangedEmail } from "../utils/emailTemplates.js";
import { 
  requestMagicLink,
  verifyMagicLink,
  resendMagicLink
} from "../controllers/magicLinkController.js";
import emailHandler from "../services/emailHandler.js";
import { 
  generateTokenPair as generateSessionTokenPair,
  storeRefreshToken,
  validateRefreshToken,
  findUserByRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
  logLoginAttempt,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setAccessTokenCookie,
  clearAccessTokenCookie
} from "../utils/sessionManager.js";

const router = express.Router();

const oauthRedis = getRedisClient();

const generateToken = (user) => {
  // Different expiration times based on role
  let expiresIn;
  if (user.role === 'admin') {
    expiresIn = process.env.JWT_ADMIN_EXPIRE || "15m"; // 15 minutes for admin
  } else {
    expiresIn = process.env.JWT_EXPIRE || "30m"; // 30 minutes for regular users
  }
  
  // JWT standard claims (issuer, audience) go in options only
  // The library automatically writes them to the token
  // DO NOT duplicate in payload - causes confusion and mismatches
  return jwt.sign(
    { 
      id: user._id, 
      role: user.role
    },
    process.env.JWT_SECRET,
    { 
      expiresIn,
      issuer: process.env.JWT_ISSUER || 'autobacs-ecommerce',
      audience: process.env.JWT_AUDIENCE || 'autobacs-users',
    }
  );
};

// @route   POST /auth/register
// @desc    Register a new user
// @access  Public
router.post("/register", registerRateLimit, validateRegister, asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ 
      success: false,
      message: "User with this email already exists" 
    });
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Generate verification token
  const { token: verificationToken, hashedToken: verificationTokenHash } = generateCryptoTokenPair();

  // Create user with verification token
  const newUser = new User({ 
    name: name.trim(), 
    email: email.toLowerCase(), 
    passwordHash,
    isVerified: false,
    verificationToken: verificationTokenHash,
    verificationTokenExpire: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  });
  await newUser.save();

  // Generate JWT and refresh tokens for auto-login
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const tokens = generateSessionTokenPair(newUser, ipAddress, userAgent);
  
  // Store refresh token
  await storeRefreshToken(
    newUser,
    tokens.refreshToken,
    tokens.refreshTokenExpiry,
    ipAddress,
    userAgent
  );
  
  // Set BOTH tokens as httpOnly cookies (SECURE - XSS protected)
  setAccessTokenCookie(res, tokens.accessToken, tokens.accessTokenExpiry);
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);

  // Log successful registration
  await logLoginAttempt(newUser, true, ipAddress, userAgent);

  // Create verification URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

  // Send verification email
  const emailTemplate = emailVerificationEmail({
    name: newUser.name,
    verifyUrl,
    expiresInHours: 24
  });

  try {
    await emailHandler.sendEmail({
      to: newUser.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html
    });

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[Auth] Verification email sent to ${newUser.email}`);
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Auth] Failed to send verification email:', error);
    }
    // Continue with registration even if email fails
  }

  res.status(201).json({ 
    success: true,
    message: "User registered successfully. Please check your email to verify your account",
    // NOTE: Tokens are now set as httpOnly cookies, not in response body
    user: { 
      id: newUser._id, 
      name: newUser.name, 
      email: newUser.email, 
      role: newUser.role,
      isVerified: newUser.isVerified
    }
  });
}));

// @route   POST /auth/login
// @desc    Authenticate user and get token
// @access  Public
router.post("/login", loginRateLimit, validateLogin, asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    // Log failed attempt (for IP tracking)
    return failedLoginRateLimit(req, res, async () => {
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    });
  }

  // Compare password
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  const ipAddress = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  if (!isMatch) {
    // Log failed login attempt
    await logLoginAttempt(user, false, ipAddress, userAgent);

    // Apply failed login rate limiting
    return failedLoginRateLimit(req, res, async () => {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    });
  }

  // Block unverified accounts before issuing any tokens
  if (!user.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Please verify your email before logging in. Check your inbox or request a new verification link.",
      code: "EMAIL_NOT_VERIFIED"
    });
  }

  // Generate tokens with session management
  const tokens = generateSessionTokenPair(user, ipAddress, userAgent);
  
  // Store refresh token
  await storeRefreshToken(
    user,
    tokens.refreshToken,
    tokens.refreshTokenExpiry,
    ipAddress,
    userAgent
  );
  
  // Set BOTH tokens as httpOnly cookies (SECURE - XSS protected)
  setAccessTokenCookie(res, tokens.accessToken, tokens.accessTokenExpiry);
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);
  
  // Bind session context for admin accounts at login time (not on first API call)
  if (user.role === 'admin') {
    await User.updateOne(
      { _id: user._id },
      {
        lastAdminIPHash: crypto.createHash('sha256').update(ipAddress || 'unknown').digest('hex'),
        lastAdminUAHash: crypto.createHash('sha256').update(userAgent || 'unknown').digest('hex'),
      }
    );
  }

  // Log successful login
  await logLoginAttempt(user, true, ipAddress, userAgent);

  res.json({
    success: true,
    message: "Login successful",
    // NOTE: accessToken is now set as httpOnly cookie, not in response body
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}));

// @route   GET /auth/me
// @desc    Get current user info (for server-side verification)
// @access  Private
router.get("/me", protect, asyncHandler(async (req, res) => {
  // req.user is set by protect middleware (verified JWT)
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      isVerified: req.user.isVerified,
      // Used by the frontend cache invalidation logic — if this value changes
      // (ban, role change, force-logout), the client detects it on next background
      // revalidation and immediately updates state without waiting for TTL expiry.
      sessionVersion: req.user.sessionVersion ?? 0
    }
  });
}));

// @route   POST /auth/refresh
// @desc    Refresh access token using refresh token
// @access  Public (but rate limited to prevent abuse)
router.post("/refresh", refreshTokenRateLimit, validateRefreshTokenInput, asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  try {
    // Decode refresh token to get user ID (without verification for now)
    // We'll validate it against stored tokens
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    // Find user by refresh token (optimized lookup)
    const user = await findUserByRefreshToken(User, refreshToken);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Verify token is still valid (not expired)
    if (!validateRefreshToken(user, refreshToken)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Block unverified accounts — mirrors the login check so a user who never
    // verified their email cannot keep a live session via token rotation.
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before continuing.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Rotate refresh token (revoke old, generate new)
    const tokens = await rotateRefreshToken(user, refreshToken, ipAddress, userAgent);
    
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[Auth] Token refreshed for user: ${user.email}`);
    }
    
    // Set BOTH tokens as httpOnly cookies (SECURE - XSS protected)
    setAccessTokenCookie(res, tokens.accessToken, tokens.accessTokenExpiry);
    setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);
    
    res.json({
      success: true,
      message: 'Token refreshed successfully'
      // NOTE: Tokens are now set as httpOnly cookies, not in response body
    });
  } catch (error) {
    // SECURITY: Handle refresh token reuse detection
    if (error.message === 'REFRESH_TOKEN_REUSE_DETECTED') {
      return res.status(401).json({
        success: false,
        message: 'Session revoked due to suspicious activity. Please login again.'
      });
    }
    
    if (process.env.NODE_ENV !== 'test') {
      console.error('[Auth] Token refresh error:', error);
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
}));

// @route   POST /auth/logout
// @desc    Logout user (revoke refresh token)
// @access  Public
router.post("/logout", asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (refreshToken) {
    try {
      const user = await findUserByRefreshToken(User, refreshToken);
      if (user) {
        await revokeRefreshToken(user, refreshToken);
      }
    } catch (error) {
      console.error('[Auth] Error revoking token during logout:', error);
      // Continue with logout (clear cookie) even if DB update fails
    }
  }
  
  // Clear BOTH token cookies (SECURE - XSS protected)
  clearAccessTokenCookie(res);  // Clear access token cookie
  clearRefreshTokenCookie(res);  // Clear refresh token cookie
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// @route   POST /auth/logout-all
// @desc    Logout from all devices (revoke all refresh tokens)
// @access  Private
router.post("/logout-all", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  await revokeAllRefreshTokens(user);
  
  console.log(`[Auth] All sessions revoked for user: ${user.email}`);
  
  res.json({
    success: true,
    message: 'Logged out from all devices successfully'
  });
}));

// @route   GET /auth/sessions
// @desc    Get active sessions for current user
// @access  Private
router.get("/sessions", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('refreshTokens');
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  // Filter out expired tokens and format response
  const activeSessions = user.refreshTokens
    .filter(rt => rt.expiresAt > new Date())
    .map(rt => ({
      createdAt: rt.createdAt,
      expiresAt: rt.expiresAt,
      ipAddress: rt.ipAddress,
      deviceInfo: rt.deviceInfo
    }));
  
  res.json({
    success: true,
    sessions: activeSessions,
    count: activeSessions.length
  });
}));

// @route   POST /auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post("/forgot-password", forgotPasswordRateLimit, validateForgotPassword, asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Find user by email
  const user = await User.findOne({ email: email.toLowerCase() });

  // Always return success to prevent email enumeration
  // Even if user doesn't exist, return success message
  const successMessage = 'If an account with that email exists, password reset instructions have been sent';

  if (!user) {
    return res.json({
      success: true,
      message: successMessage
    });
  }

  // CRITICAL: Check if user already has an active reset token (prevent multiple active tokens)
  if (user.resetPasswordToken && user.resetPasswordExpire > Date.now()) {
    console.log(`[Auth] User ${user.email} already has an active reset token, invalidating old token`);
    // Old token will be replaced below
  }

  // Generate reset token
  const { token, hashedToken } = generateCryptoTokenPair();
  
  // Set reset token and expiration (15 minutes - security best practice)
  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpire = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  user.resetPasswordUsed = false;
  await user.save();

  // Create reset URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  // Send reset email
  const emailTemplate = passwordResetEmail({
    name: user.name,
    resetUrl,
    expiresInMinutes: 15
  });

  try {
    await emailHandler.sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html
    });

    console.log(`[Auth] Password reset email sent to ${user.email}`);
  } catch (error) {
    console.error('[Auth] Failed to send password reset email');
    // SECURITY: Don't log error details (may contain sensitive info)
    // Still return success to prevent email enumeration
  }

  res.json({
    success: true,
    message: successMessage
  });
}));

// @route   GET /auth/verify-reset-token
// @desc    Verify password reset token validity
// @access  Public
router.get("/verify-reset-token", validateTokenQuery, asyncHandler(async (req, res) => {
  const { token } = req.query;

  // Hash the provided token
  const hashedToken = hashToken(token);

  // Find user with this token
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
    resetPasswordUsed: false
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      valid: false,
      message: 'Invalid or expired reset token'
    });
  }

  res.json({
    success: true,
    valid: true
  });
}));

// @route   POST /auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post("/reset-password", resetPasswordRateLimit, validateResetPassword, asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  // Hash the provided token
  const hashedToken = hashToken(token);

  // Find user with valid token
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
    resetPasswordUsed: false
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired reset token. Please request a new password reset'
    });
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.passwordHash = await bcrypt.hash(password, salt);

  // Mark token as used and clear reset fields
  user.resetPasswordUsed = true;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();

  // CRITICAL: Atomic increment of session version (prevents race conditions)
  // This ensures user must login again with new password
  await User.updateOne(
    { _id: user._id },
    { $inc: { sessionVersion: 1 } }
  );

  // Log security event
  console.log(`[Auth] Password reset successful for user: ${user.email} | Session invalidated`);
  const emailTemplate = passwordChangedEmail({ name: user.name });
  
  try {
    await emailHandler.sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html
    });
  } catch (error) {
    console.error('[Auth] Failed to send password changed email');
    // SECURITY: Don't log error details (may contain sensitive info)
    // Continue anyway, password was changed successfully
  }

  console.log(`[Auth] Password reset successful for user: ${user.email}`);

  res.json({
    success: true,
    message: 'Password reset successful. You can now login with your new password'
  });
}));

// @route   GET /auth/verify-email
// @desc    Verify email address with token
// @access  Public
router.get("/verify-email", verifyEmailRateLimit, validateTokenQuery, asyncHandler(async (req, res) => {
  const { token } = req.query;

  // Hash the provided token
  const hashedToken = hashToken(token);

  // Find user with this token
  const user = await User.findOne({
    verificationToken: hashedToken,
    verificationTokenExpire: { $gt: Date.now() }
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired verification token'
    });
  }

  // Check if already verified
  if (user.isVerified) {
    return res.status(400).json({
      success: false,
      message: 'Email is already verified'
    });
  }

  // Mark email as verified
  user.isVerified = true;
  user.verifiedAt = new Date();
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;

  await user.save();

  console.log(`[Auth] Email verified for user: ${user.email}`);

  res.json({
    success: true,
    message: 'Email verified successfully',
    user: {
      id: user._id,
      email: user.email,
      isVerified: user.isVerified
    }
  });
}));

// @route   POST /auth/resend-verification
// @desc    Resend verification email
// @access  Public or Private (optional auth)
router.post("/resend-verification", resendVerificationRateLimit, optionalAuth, validateResendVerification, asyncHandler(async (req, res) => {
  let email;

  // If authenticated, use user's email
  if (req.user) {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    email = user.email;
  } else {
    // If not authenticated, use email from body (validated)
    email = req.body.email;
  }

  // Find user
  const user = await User.findOne({ email: email.toLowerCase() });

  // Return generic success message to prevent email enumeration
  const successMessage = 'If your email is registered and unverified, verification instructions have been sent';

  if (!user) {
    return res.json({
      success: true,
      message: successMessage
    });
  }

  // Check if already verified
  if (user.isVerified) {
    return res.status(400).json({
      success: false,
      message: 'Email is already verified'
    });
  }

  // Generate new verification token
  const { token, hashedToken } = generateCryptoTokenPair();
  
  // Set verification token and expiration (24 hours)
  user.verificationToken = hashedToken;
  user.verificationTokenExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await user.save();

  // Create verification URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

  // Send verification email
  const emailTemplate = emailVerificationEmail({
    name: user.name,
    verifyUrl,
    expiresInHours: 24
  });

  try {
    await emailHandler.sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html
    });

    console.log(`[Auth] Verification email sent to ${user.email}`);
  } catch (error) {
    console.error('[Auth] Failed to send verification email:', error);
    // Still return success to prevent email enumeration
  }

  res.json({
    success: true,
    message: successMessage
  });
}));

// @route   GET /auth/verification-status
// @desc    Get email verification status for authenticated user
// @access  Private
router.get("/verification-status", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('email isVerified verifiedAt');
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    isVerified: user.isVerified || false,
    email: user.email,
    verifiedAt: user.verifiedAt
  });
}));

const findOrCreateSocialUser = async ({ name, email, isVerified }) => {
  if (!email) {
    throw new Error('Email is required for social login');
  }

  const normalizedEmail = email.toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    const randomPassword = Math.random().toString(36).slice(-12) + Date.now().toString(36);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(randomPassword, salt);

    user = new User({
      name: name?.trim() || normalizedEmail,
      email: normalizedEmail,
      passwordHash,
      isVerified: !!isVerified
    });
    await user.save();
  } else if (isVerified && !user.isVerified) {
    user.isVerified = true;
    await user.save();
  }

  return user;
};

const completeSocialLogin = async (req, res, user, provider) => {
  const ipAddress = req.headers['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const tokens = generateSessionTokenPair(user, ipAddress, userAgent);

  // Store refresh token
  await storeRefreshToken(
    user,
    tokens.refreshToken,
    tokens.refreshTokenExpiry,
    ipAddress,
    userAgent
  );

  // Set refresh token cookie
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);

  // Bind session context for admin accounts (mirrors the password-login flow)
  if (user.role === 'admin') {
    await User.updateOne(
      { _id: user._id },
      {
        lastAdminIPHash: crypto.createHash('sha256').update(ipAddress || 'unknown').digest('hex'),
        lastAdminUAHash: crypto.createHash('sha256').update(userAgent || 'unknown').digest('hex'),
      }
    );
  }

  // Log successful login
  await logLoginAttempt(user, true, ipAddress, userAgent);

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3001";
  console.log(`[Auth] FRONTEND_URL from env: ${process.env.FRONTEND_URL}`);
  console.log(`[Auth] Using frontendUrl: ${frontendUrl}`);
  console.log(`[Auth] Will redirect to: ${frontendUrl}/auth/social-callback?code=...`);
  
  // Force redeploy 2026-04-29

  // ── Secure: one-time code exchange (PKCE-lite) ──────────────────────────
  // Never send tokens in the URL — they would leak into browser history,
  // server logs, and Referer headers. Instead, store tokens server-side
  // behind a short-lived one-time code and let the frontend POST to exchange it.
  if (oauthRedis) {
    const code = crypto.randomBytes(32).toString('hex');
    await oauthRedis.set(
      `oauth:code:${code}`,
      JSON.stringify({ userId: String(user._id), provider }),
      'EX',
      60  // code valid for 60 seconds, one-time use
    );
    // Stash the actual tokens against the code so /exchange-code can return them
    await oauthRedis.set(
      `oauth:tokens:${code}`,
      JSON.stringify({
        accessToken: tokens.accessToken,
        expiresIn: tokens.accessTokenExpiry
      }),
      'EX',
      60
    );
    return res.redirect(`${frontendUrl}/auth/social-callback?code=${code}`);
  }

  // ── Fallback (no Redis): legacy hash fragment ─────────────────────────────
  // Only reached when Redis is not configured (local dev without Redis).
  // REDIS_URL must be set in production.
  console.warn('[Auth] REDIS_URL not set — falling back to insecure hash-fragment token delivery');
  const hashParams = new URLSearchParams({
    accessToken: tokens.accessToken,
    expiresIn: String(tokens.accessTokenExpiry),
    provider
  }).toString();
  res.redirect(`${frontendUrl}/auth/social-callback#${hashParams}`);
};

router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({
      success: false,
      message: "Google client ID is not configured"
    });
  }

  // Force exact callback URL from environment variable (no fallback)
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;
  if (!redirectUri) {
    return res.status(500).json({
      success: false,
      message: "GOOGLE_CALLBACK_URL environment variable is not configured"
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ["openid", "email", "profile"].join(" "),
    access_type: "offline",
    prompt: "consent"
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    console.log('========================================');
    console.log('[Google Callback] HIT! Route executed');
    console.log('[Google Callback] FRONTEND_URL:', process.env.FRONTEND_URL);
    console.log('========================================');
    
    const code = req.query.code;

    if (!code) {
      // Redirect back to login page with error message instead of JSON response
      const frontendUrl = process.env.FRONTEND_URL || 'https://ecommerceautobacs-production-8c1b.up.railway.app';
      return res.redirect(`${frontendUrl}/login?error=google_cancelled&message=Google%20Sign-In%20was%20cancelled`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        message: "Google OAuth credentials are not configured"
      });
    }

    const redirectUri =
      process.env.GOOGLE_CALLBACK_URL ||
      `${req.protocol}://${req.get("host")}/api/v1/auth/google/callback`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("[Auth] Google token exchange failed:", tokenData);
      return res.status(400).json({
        success: false,
        message: "Failed to complete Google login"
      });
    }

    const idToken = tokenData.id_token;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid Google token response"
      });
    }

    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );
    const tokenInfo = await tokenInfoResponse.json();

    if (!tokenInfoResponse.ok) {
      console.error("[Auth] Google token verification failed:", tokenInfo);
      return res.status(400).json({
        success: false,
        message: "Failed to verify Google token"
      });
    }

    const email = tokenInfo.email;
    const name = tokenInfo.name || email;
    const emailVerified =
      tokenInfo.email_verified === "true" || tokenInfo.email_verified === true;

    try {
      const user = await findOrCreateSocialUser({
        name,
        email,
        isVerified: emailVerified
      });

      await completeSocialLogin(req, res, user, "google");
    } catch (error) {
      console.error("[Auth] Google social login error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to complete Google social login"
      });
    }
  })
);

router.get("/facebook", (req, res) => {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({
      success: false,
      message: "Facebook client ID is not configured"
    });
  }

  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/auth/facebook/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ["email", "public_profile"].join(",")
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
});

router.get(
  "/facebook/callback",
  asyncHandler(async (req, res) => {
    const code = req.query.code;
    const frontendUrl = process.env.FRONTEND_URL || 'https://ecommerceautobacs-production-8c1b.up.railway.app';

    if (!code) {
      return res.redirect(`${frontendUrl}/login?error=facebook_cancelled&message=Facebook%20Sign-In%20was%20cancelled`);
    }

    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        success: false,
        message: "Facebook OAuth credentials are not configured"
      });
    }

    const redirectUri =
      process.env.FACEBOOK_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/auth/facebook/callback`;

    const tokenResponse = await fetch(
      "https://graph.facebook.com/v19.0/oauth/access_token?" +
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code
        }).toString(),
      {
        method: "GET"
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("[Auth] Facebook token exchange failed:", tokenData);
      return res.status(400).json({
        success: false,
        message: "Failed to complete Facebook login"
      });
    }

    const userResponse = await fetch(
      "https://graph.facebook.com/me?" +
        new URLSearchParams({
          fields: "id,name,email",
          access_token: tokenData.access_token
        }).toString(),
      {
        method: "GET"
      }
    );

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      console.error("[Auth] Facebook user fetch failed:", userData);
      return res.status(400).json({
        success: false,
        message: "Failed to fetch Facebook user profile"
      });
    }

    const email = userData.email;
    const name = userData.name;

    if (!email) {
      return res.redirect(
        `${frontendUrl}/login?error=facebook_no_email&message=Facebook%20did%20not%20provide%20an%20email%20address.%20Please%20use%20a%20different%20sign-in%20method.`
      );
    }

    try {
      const user = await findOrCreateSocialUser({
        name,
        email,
        isVerified: true
      });

      await completeSocialLogin(req, res, user, "facebook");
    } catch (error) {
      console.error("[Auth] Facebook social login error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to complete Facebook social login"
      });
    }
  })
);

// POST /exchange-code
// Exchanges a short-lived one-time OAuth code for an access token.
// The code was stored in Redis by completeSocialLogin (max 60 s, single use).
router.post(
  "/exchange-code",
  asyncHandler(async (req, res) => {
    const { code } = req.body;

    console.log('[Auth] Exchange-code request received');
    console.log('[Auth] Code format valid:', !!code && typeof code === 'string' && /^[a-f0-9]{64}$/.test(code));

    if (!code || typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Invalid code format' });
    }

    if (!oauthRedis) {
      console.error('[Auth] Redis not available for code exchange');
      return res.status(503).json({
        success: false,
        message: 'Code exchange unavailable — Redis not configured'
      });
    }

    const codeKey   = `oauth:code:${code}`;
    const tokensKey = `oauth:tokens:${code}`;

    console.log('[Auth] Fetching code and tokens from Redis...');
    // Fetch both keys atomically before deleting
    const [codeData, tokensData] = await Promise.all([
      oauthRedis.get(codeKey),
      oauthRedis.get(tokensKey)
    ]);

    console.log('[Auth] Code data found:', !!codeData);
    console.log('[Auth] Tokens data found:', !!tokensData);

    if (!codeData || !tokensData) {
      console.error('[Auth] Invalid or expired code - data not found in Redis');
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    // Delete both keys — one-time use
    await Promise.all([
      oauthRedis.del(codeKey),
      oauthRedis.del(tokensKey)
    ]);

    let parsedCode, parsedTokens;
    try {
      parsedCode   = JSON.parse(codeData);
      parsedTokens = JSON.parse(tokensData);
    } catch {
      return res.status(500).json({ success: false, message: 'Malformed code data' });
    }

    console.log(`[Auth] OAuth code exchanged | user: ${parsedCode.userId} | provider: ${parsedCode.provider}`);
    console.log(`[Auth] DEPLOY CHECK: Cookie domain will be set to ${process.env.NODE_ENV === 'production' ? '.up.railway.app' : 'undefined'}`);
    console.log('[Auth] Setting access token cookie...');
    console.log('[Auth] Token exists:', !!parsedTokens.accessToken);
    console.log('[Auth] ExpiresIn:', parsedTokens.expiresIn);
    console.log('[Auth] NODE_ENV:', process.env.NODE_ENV);
    console.log('[Auth] Will set secure:', process.env.NODE_ENV === 'production');
    console.log('[Auth] Will set sameSite:', process.env.NODE_ENV === 'production' ? 'none' : 'lax');

    // Set access token as httpOnly cookie (SECURE - XSS protected)
    // parsedTokens should contain accessToken and expiresIn from social login
    if (parsedTokens.accessToken && parsedTokens.expiresIn) {
      console.log('[Auth] Calling setAccessTokenCookie...');
      setAccessTokenCookie(res, parsedTokens.accessToken, parsedTokens.expiresIn);
      console.log('[Auth] Access token cookie set successfully');
      
      // Manually check what headers are set
      const headers = res.getHeaders();
      console.log('[Auth] Response headers set:', Object.keys(headers));
      console.log('[Auth] Has set-cookie header:', 'set-cookie' in headers || 'Set-Cookie' in headers);
      if (headers['set-cookie'] || headers['Set-Cookie']) {
        console.log('[Auth] Set-Cookie value:', headers['set-cookie'] || headers['Set-Cookie']);
      }
    } else {
      console.error('[Auth] Missing accessToken or expiresIn in tokens data');
    }

    // Fetch and return user data so the frontend can hydrate auth state
    // immediately without a second GET /me round-trip.
    const user = await User.findById(parsedCode.userId)
      .select('_id name email role isVerified sessionVersion')
      .lean();

    console.log('[Auth] Sending success response');
    return res.json({
      success: true,
      user: user
        ? {
            id: user._id,
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            isVerified: user.isVerified,
            sessionVersion: user.sessionVersion ?? 0,
          }
        : undefined,
    });
  })
);

// ========================================
// MAGIC LINK AUTHENTICATION ROUTES
// ========================================

// @route   POST /auth/magic-link/request
// @desc    Request magic link for guest order claiming
// @access  Public
router.post("/magic-link/request", asyncHandler(requestMagicLink));

// @route   POST /auth/magic-link/verify
// @desc    Verify magic link and claim account
// @access  Public
router.post("/magic-link/verify", asyncHandler(verifyMagicLink));

// @route   POST /auth/magic-link/resend
// @desc    Resend magic link
// @access  Public
router.post("/magic-link/resend", asyncHandler(resendMagicLink));

export default router;
