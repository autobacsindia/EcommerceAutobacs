import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

/**
 * @route   GET /api/debug/env
 * @desc    Debug environment variables (safe subset)
 * @access  Public (for debugging only - should be removed or protected in prod)
 */
router.get('/env', (req, res) => {
  const wpSiteUrl = process.env.WORDPRESS_SITE_URL;
  const wpApiKey = process.env.WORDPRESS_API_KEY;
  const wpApiSecret = process.env.WORDPRESS_API_SECRET;
  
  res.json({
    success: true,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URL: process.env.FRONTEND_URL,
      WORDPRESS_SITE_URL: wpSiteUrl,
      WORDPRESS_API_KEY_SET: !!wpApiKey,
      WORDPRESS_API_KEY_PREFIX: wpApiKey ? wpApiKey.substring(0, 3) : null,
      WORDPRESS_API_KEY_LENGTH: wpApiKey ? wpApiKey.length : 0,
      WORDPRESS_API_SECRET_SET: !!wpApiSecret,
      WORDPRESS_API_SECRET_PREFIX: wpApiSecret ? wpApiSecret.substring(0, 3) : null,
      WORDPRESS_API_SECRET_LENGTH: wpApiSecret ? wpApiSecret.length : 0,
    },
    headers: {
      origin: req.headers.origin,
      host: req.headers.host,
    }
  });
});

export default router;
