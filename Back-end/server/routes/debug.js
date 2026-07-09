import express from 'express';

const router = express.Router();

/**
 * @route   GET /api/debug/env
 * @desc    Debug environment variables (safe subset)
 * @access  Public (for debugging only - should be removed or protected in prod)
 */
router.get('/env', (req, res) => {
  // SEC-2: expose only booleans — no key prefixes/lengths (a format/length oracle),
  // no site URL. This route is also mounted only when NODE_ENV !== 'production'.
  res.json({
    success: true,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URL: process.env.FRONTEND_URL,
      WORDPRESS_SITE_URL_SET: !!process.env.WORDPRESS_SITE_URL,
      WORDPRESS_API_KEY_SET: !!process.env.WORDPRESS_API_KEY,
      WORDPRESS_API_SECRET_SET: !!process.env.WORDPRESS_API_SECRET,
    },
    headers: {
      origin: req.headers.origin,
      host: req.headers.host,
    }
  });
});

export default router;
