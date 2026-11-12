/**
 * Customer rating of the sale and service on a delivered order.
 * Logic and rules: services/orderRatingService.js. Mounted at /order-ratings.
 *
 * There is deliberately no PUT/PATCH/DELETE: staff and admins can read ratings
 * (admins and team heads only) but nobody in the panel can change one.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, optionalAuth, staffOrAdmin } from '../middleware/authMiddleware.js';
import { orderRatingRateLimit } from '../middleware/rateLimitMiddleware.js';
import { getClientIp } from '../middleware/rate-limit/clientIp.js';
import orderRatingService from '../services/orderRatingService.js';

const router = express.Router();

/** Service errors carry `status` + `code`; anything else is a real 500. */
const handle = (fn) => asyncHandler(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err?.status) throw err;
    res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
});

// The link path is public — the signed token is the authorisation. optionalAuth
// is there only so a signed-in staff member opening a customer's link is refused.
router.get('/link/:token', orderRatingRateLimit, optionalAuth, handle(async (req, res) => {
  res.json({ success: true, ...(await orderRatingService.getForLink(req.params.token, req.user)) });
}));

router.post('/link/:token', orderRatingRateLimit, optionalAuth, handle(async (req, res) => {
  const out = await orderRatingService.submitByLink(req.params.token, req.body, req.user, getClientIp(req));
  res.status(out.created ? 201 : 200).json({ success: true, ...out });
}));

// Signed-in customer, own order.
router.get('/mine/:orderId', orderRatingRateLimit, protect, handle(async (req, res) => {
  res.json({ success: true, ...(await orderRatingService.getForAccount(req.params.orderId, req.user)) });
}));

router.post('/mine/:orderId', orderRatingRateLimit, protect, handle(async (req, res) => {
  const out = await orderRatingService.submitByAccount(req.params.orderId, req.body, req.user);
  res.status(out.created ? 201 : 200).json({ success: true, ...out });
}));

// Panel. Ratings are read only: admins and team heads see them; the order's own
// salesperson sees only whether a link can be sent.
router.get('/panel/order/:orderId', protect, staffOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await orderRatingService.getOrderRatingForPanel(req.user, req.params.orderId)) });
}));

// Offline orders: a link the salesperson sends the customer on WhatsApp.
router.post('/panel/order/:orderId/share-link', orderRatingRateLimit, protect, staffOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await orderRatingService.createShareLink(req.user, req.params.orderId, getClientIp(req))) });
}));

router.get('/panel/monthly', protect, staffOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await orderRatingService.monthlySummary(req.user, req.query.month)) });
}));

export default router;
