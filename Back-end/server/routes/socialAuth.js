import express from 'express';
import axios from 'axios';
import User from '../models/User.js';
import { generateTokenPair as generateSessionTokenPair, storeRefreshToken, setRefreshTokenCookie, logLoginAttempt } from '../utils/sessionManager.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Ensure no trailing slash and consistent protocol/port
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// @route   GET /auth/google
// @desc    Initiate Google OAuth flow
// @access  Public
router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    console.error('GOOGLE_CLIENT_ID is not defined');
    return res.redirect(`${FRONTEND_URL}/login?error=Google login not configured`);
  }

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
  ];
  
  // Clean keys
  const clientId = GOOGLE_CLIENT_ID.trim();
  const callbackUrl = GOOGLE_CALLBACK_URL.trim();

  // Use the exact callback URL configured in environment
  const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&access_type=offline&prompt=consent`;
  
  res.redirect(redirectUrl);
});

// @route   GET /auth/google/callback
// @desc    Handle Google OAuth callback
// @access  Public
router.get('/google/callback', asyncHandler(async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect(`${FRONTEND_URL}/login?error=Google login failed`);
  }

  try {
    // Exchange code for tokens
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    });

    const { access_token } = data;

    // Get user info
    const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // Check if user exists
    let user = await User.findOne({ email: profile.email });

    if (!user) {
      // Create new user
      user = await User.create({
        name: profile.name,
        email: profile.email,
        passwordHash: '', // Social login users don't have a password
        isVerified: true, // Google emails are verified
        googleId: profile.id,
        avatar: profile.picture,
        role: 'user'
      });
    } else {
        // Link google ID if not linked
        let updated = false;
        if (!user.googleId) {
            user.googleId = profile.id;
            updated = true;
        }
        if (!user.avatar && profile.picture) {
            user.avatar = profile.picture;
            updated = true;
        }
        if (updated) await user.save();
    }

    // Generate tokens
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const tokens = generateSessionTokenPair(user, ipAddress, userAgent);
    
    await storeRefreshToken(user, tokens.refreshToken, tokens.refreshTokenExpiry, ipAddress, userAgent);
    setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiry);
    await logLoginAttempt(user, true, ipAddress, userAgent);

    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/auth/social-callback?token=${tokens.accessToken}`);
    
  } catch (error) {
    console.error('Google Auth Error:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/login?error=Google authentication failed`);
  }
}));

export default router;
