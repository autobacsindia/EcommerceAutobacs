/**
 * Public payment configuration — the non-secret values the storefront needs to embed
 * payment UI outside checkout (today: the Razorpay Affordability/EMI widget on the PDP).
 *
 * Why this exists: the widget used to read a build-time NEXT_PUBLIC_RAZORPAY_KEY_ID baked
 * into the Vercel bundle. After a key rotation that copy went stale, Razorpay answered the
 * widget with 401 and the EMI strip vanished from every product page — while checkout,
 * which already took its key from this server, kept working. Serving the key from here
 * makes the backend env the single source for both.
 *
 * Never put anything here that is not already public by design. The key SECRET must not
 * be reachable from this router.
 *
 * Mounted outside /razorpay on purpose: that router carries checkoutRateLimit and the
 * payment-session keep-alive middleware, neither of which belongs on a PDP read.
 */
import express from 'express';
import razorpayService from '../services/razorpayService.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import { paymentConfigRateLimit } from '../middleware/rate-limit/ecommerceLimiters.js';

const router = express.Router();

// @route   GET /payment-config/razorpay
// @desc    The public Razorpay key id (same one checkout uses) — never the secret
// @access  Public, edge-cacheable (shared, non-personalised)
router.get('/razorpay', paymentConfigRateLimit, cacheMiddleware('static-data'), (req, res) => {
  const keyId = razorpayService.getPublicKeyId();

  if (!keyId) {
    // A misconfiguration, not a visitor problem: say so plainly, and never let a CDN
    // pin the failure for the s-maxage window once the env is fixed.
    console.error('[PaymentConfig] RAZORPAY_KEY_ID is missing or malformed — EMI widget disabled');
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
      success: false,
      message: 'Payment configuration unavailable',
    });
  }

  return res.json({ success: true, data: { keyId } });
});

export default router;
