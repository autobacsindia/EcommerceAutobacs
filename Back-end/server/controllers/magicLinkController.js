/**
 * Magic Link Authentication Controller
 * Handles guest user account claiming via magic links
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Order from "../models/Order.js";
import emailHandler from "../services/emailHandler.js";
import {
  generateTokenPair,
  storeRefreshToken,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from "../utils/sessionManager.js";

/**
 * @desc    Request magic link for guest order claiming
 * @route   POST /auth/magic-link/request
 * @access  Public
 */
export const requestMagicLink = async (req, res) => {
  try {
    const { email, phone, orderId } = req.body;
    
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone is required'
      });
    }
    
    // Find user
    const user = await User.findOne(
      email ? { email: email.toLowerCase() } : { phone }
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email/phone'
      });
    }
    
    // Generate magic link token
    const token = crypto.randomBytes(32).toString('hex');
    user.magicLinkToken = token;
    user.magicLinkExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    
    // If orderId provided, verify user owns this order
    if (orderId) {
      const order = await Order.findById(orderId);
      
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
      
      if (order.user.toString() !== user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'This order does not belong to you'
        });
      }
    }
    
    await user.save();
    
    // Send magic link email
    if (email && user.email) {
      try {
        await emailHandler.sendMagicLinkEmail(user.email, token, orderId);
        console.log('[MAGIC_LINK] Sent to:', user.email);
      } catch (emailError) {
        console.error('[MAGIC_LINK] Failed to send email:', emailError.message);
      }
    }
    
    res.json({
      success: true,
      message: `Magic link sent to ${email || phone}`,
      // In development, include token for testing
      ...(process.env.NODE_ENV === 'development' && {
        debugToken: token,
        debugMessage: 'Token included for development testing only'
      })
    });
    
  } catch (error) {
    console.error('[MAGIC_LINK_REQUEST_ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send magic link',
      error: error.message
    });
  }
};

/**
 * @desc    Verify magic link and claim account
 * @route   POST /auth/magic-link/verify
 * @access  Public
 */
export const verifyMagicLink = async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }
    
    // Find user by token
    const user = await User.findOne({
      magicLinkToken: token,
      magicLinkExpires: { $gt: new Date() } // Not expired
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired magic link'
      });
    }
    
    // Claim the account. This path covers BOTH guest-checkout claims (isGuest)
    // and accounts provisioned for the buyer by staff — offline orders and
    // WooCommerce migrations create a real (non-guest) account flagged
    // `mustResetPassword`. Gating on `isGuest` alone silently dropped the
    // password for those buyers and left the (still-live) token reusable, so
    // "set a password for the first time" never actually worked for them.
    if (password) {
      // Match the reset-password contract (8–72 chars) so the claim link can't
      // set a weaker password than the normal reset flow.
      if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return res.status(400).json({
          success: false,
          message: 'Password must be between 8 and 72 characters',
        });
      }
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password, salt);
      // A chosen password clears the "must set one" gate; leaving it blank keeps
      // the account passwordless (magic-link only) by choice.
      user.mustResetPassword = false;
    }

    user.isGuest = false;
    if (!user.isVerified) {
      user.isVerified = true;
      user.verifiedAt = new Date();
    }
    // Single-use: consume the token on every successful claim, password or not.
    user.magicLinkToken = undefined;
    user.magicLinkExpires = undefined;

    await user.save();
    console.log('[MAGIC_LINK] Account claimed:', user.email);
    
    // Establish a real session the SAME way login/register do: httpOnly access +
    // refresh cookies with a server-stored refresh token. The previous code returned
    // the access token in the JSON body and set no cookie, so the cookie-based
    // frontend never actually logged the buyer in after they claimed the account.
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers?.['user-agent'] || null;
    const tokens = generateTokenPair(user, ipAddress, userAgent);
    await storeRefreshToken(user, tokens.refreshToken, tokens.refreshTokenExpiry, ipAddress, userAgent);
    setAccessTokenCookie(res, tokens.accessToken, tokens.accessTokenExpiry);
    setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      },
      message: 'Account claimed successfully!'
    });
    
  } catch (error) {
    console.error('[MAGIC_LINK_VERIFY_ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify magic link',
      error: error.message
    });
  }
};

/**
 * @desc    Resend magic link
 * @route   POST /auth/magic-link/resend
 * @access  Public
 */
export const resendMagicLink = async (req, res) => {
  try {
    // Reuse requestMagicLink logic
    await requestMagicLink(req, res);
    
  } catch (error) {
    console.error('[MAGIC_LINK_RESEND_ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend magic link',
      error: error.message
    });
  }
};
