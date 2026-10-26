import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import * as push from '../services/pushService.js';

/** Push notifications for staff and admins (/api/v1/push). */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const chatPathFor = (user) => (user?.role === 'admin' ? '/admin/chat' : '/team/chat');

// GET /push/public-key — null when push is not set up (the panel then hides the switch)
router.get('/public-key', (req, res) => {
  res.json({ success: true, publicKey: push.publicKey() });
});

// POST /push/subscriptions { endpoint, keys: { p256dh, auth } } — this device
router.post('/subscriptions', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, ...(await push.subscribe(req.user, req.body, req.get('user-agent'))) });
}));

// POST /push/unsubscribe { endpoint } — this device stops (also on logout). A POST,
// not DELETE-with-body: the endpoint is a capability URL and must not end up in a
// query string / access log.
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await push.unsubscribe(req.user, req.body?.endpoint)) });
}));

// POST /push/test — a test pop-up to my devices
router.post('/test', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await push.sendTest(req.user, chatPathFor(req.user))) });
}));

export default router;
