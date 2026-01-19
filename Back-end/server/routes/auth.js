import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateRegister, validateLogin } from "../middleware/validationMiddleware.js";
import { 
  registerRateLimit, 
  loginRateLimit, 
  failedLoginRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  resendVerificationRateLimit,
  verifyEmailRateLimit
} from "../middleware/rateLimitMiddleware.js";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { generateTokenPair as generateCryptoTokenPair, hashToken } from "../utils/tokenUtils.js";
import { passwordResetEmail, emailVerificationEmail, passwordChangedEmail } from "../utils/emailTemplates.js";
import emailHandler from "../services/emailHandler.js";
import { 
  generateTokenPair as generateSessionTokenPair,
  storeRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
  logLoginAttempt
} from "../utils/sessionManager.js";

const router = express.Router();

// Helper function to generate JWT token with role-based expiration
const generateToken = (user) => {
  // Different expiration times based on role
  let expiresIn;
  if (user.role === 'admin') {
    expiresIn = process.env.JWT_ADMIN_EXPIRE || "15m"; // 15 minutes for admin
  } else {
    expiresIn = process.env.JWT_EXPIRE || "30m"; // 30 minutes for regular users
  }
  
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn }
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

    console.log(`[Auth] Verification email sent to ${newUser.email}`);
  } catch (error) {
    console.error('[Auth] Failed to send verification email:', error);
    // Continue with registration even if email fails
  }

  res.status(201).json({ 
    success: true,
    message: "User registered successfully. Please check your email to verify your account",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.accessTokenExpiry,
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
  const ipAddress = req.ip || req.connection.remoteAddress;
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
  
  // Log successful login
  await logLoginAttempt(user, true, ipAddress, userAgent);

  res.json({
    success: true,
    message: "Login successful",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.accessTokenExpiry,
    user: { 
      id: user._id, 
      name: user.name, 
      email: user.email, 
      role: user.role 
    }
  });
}));

// @route   POST /auth/refresh
// @desc    Refresh access token using refresh token
// @access  Public
router.post("/refresh", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required'
    });
  }

  try {
    // Decode refresh token to get user ID (without verification for now)
    // We'll validate it against stored tokens
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    // Find user by checking all users' refresh tokens
    // In production, consider adding user ID to refresh token payload
    const users = await User.find({ 'refreshTokens.0': { $exists: true } });
    let user = null;
    
    for (const u of users) {
      if (validateRefreshToken(u, refreshToken)) {
        user = u;
        break;
      }
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
    
    // Rotate refresh token (revoke old, generate new)
    const tokens = await rotateRefreshToken(user, refreshToken, ipAddress, userAgent);
    
    console.log(`[Auth] Token refreshed for user: ${user.email}`);
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.accessTokenExpiry
    });
  } catch (error) {
    console.error('[Auth] Token refresh error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
}));

// @route   POST /auth/logout
// @desc    Logout and revoke refresh token
// @access  Private or Public (with refresh token)
router.post("/logout", asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
  
  try {
    // Find user and revoke refresh token
    const users = await User.find({ 'refreshTokens.0': { $exists: true } });
    
    for (const user of users) {
      if (validateRefreshToken(user, refreshToken)) {
        await revokeRefreshToken(user, refreshToken);
        console.log(`[Auth] User logged out: ${user.email}`);
        break;
      }
    }
  } catch (error) {
    console.error('[Auth] Logout error:', error);
  }
  
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

// @route   GET /auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    user
  });
}));

// @route   POST /auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post("/forgot-password", forgotPasswordRateLimit, asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email address is required'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Valid email address required'
    });
  }

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

  // Generate reset token
  const { token, hashedToken } = generateCryptoTokenPair();
  
  // Set reset token and expiration (1 hour)
  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  user.resetPasswordUsed = false;
  await user.save();

  // Create reset URL
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  // Send reset email
  const emailTemplate = passwordResetEmail({
    name: user.name,
    resetUrl,
    expiresInMinutes: 60
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
    console.error('[Auth] Failed to send password reset email:', error);
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
router.get("/verify-reset-token", asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      success: false,
      valid: false,
      message: 'Reset token is required'
    });
  }

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
router.post("/reset-password", resetPasswordRateLimit, asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({
      success: false,
      message: 'Token and new password are required'
    });
  }

  // Validate password strength
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

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

  // Send password changed notification
  const emailTemplate = passwordChangedEmail({ name: user.name });
  
  try {
    await emailHandler.sendEmail({
      to: user.email,
      subject: emailTemplate.subject,
      text: emailTemplate.text,
      html: emailTemplate.html
    });
  } catch (error) {
    console.error('[Auth] Failed to send password changed email:', error);
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
router.get("/verify-email", verifyEmailRateLimit, asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: 'Verification token is required'
    });
  }

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
router.post("/resend-verification", resendVerificationRateLimit, optionalAuth, asyncHandler(async (req, res) => {
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
    // If not authenticated, require email in body
    email = req.body?.email;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }
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
  const ipAddress = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const tokens = generateSessionTokenPair(user, ipAddress, userAgent);

  await storeRefreshToken(
    user,
    tokens.refreshToken,
    tokens.refreshTokenExpiry,
    ipAddress,
    userAgent
  );

  await logLoginAttempt(user, true, ipAddress, userAgent);

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const hashParams = new URLSearchParams({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: String(tokens.accessTokenExpiry),
    provider
  }).toString();

  const redirectUrl = `${frontendUrl}/auth/social-callback#${hashParams}`;
  res.redirect(redirectUrl);
};

router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({
      success: false,
      message: "Google client ID is not configured"
    });
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/auth/google/callback`;

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
    const code = req.query.code;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code not provided"
      });
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
      process.env.GOOGLE_REDIRECT_URI ||
      `${req.protocol}://${req.get("host")}/auth/google/callback`;

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

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code not provided"
      });
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

export default router;
