import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { admin, protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import * as push from '../services/pushService.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';

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

// POST /push/test { endpoint?, testId? } — a test pop-up to THIS browser (endpoint),
// or to all my devices (no endpoint: an older page). In the body, never the URL.
router.post('/test', asyncHandler(async (req, res) => {
  const { endpoint, testId } = req.body || {};
  res.json({ success: true, ...(await push.sendTest(req.user, chatPathFor(req.user), { endpoint, testId })) });
}));

// GET /push/devices — admin: who has pop-ups, on which browsers, and whether they work
router.get('/devices', admin, asyncHandler(async (req, res) => {
  const people = (await userRepository.findChatUsers()).map((u) => ({
    id: String(u._id),
    name: u.name || '',
    team: u.role === 'admin' ? 'Admin' : STAFF_TEAM_LABELS[u.staff?.team] || '',
    isHead: u.role === 'staff' && u.staff?.isHead === true,
  }));
  res.json({ success: true, ...(await push.listDevices(people)) });
}));

export default router;
