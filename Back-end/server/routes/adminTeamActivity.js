import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { waitingBoard, orderTimeline, teamPerformance } from '../services/teamActivityService.js';

/**
 * Admin Team activity (/api/v1/admin/team-activity) — read-only views of the
 * order workflow: what is waiting now, one order's timeline, and per-team /
 * per-person response times. Admins only; nothing here writes.
 */
const router = express.Router();
router.use(protect, admin);

// Per-request, per-admin numbers: never cached anywhere.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /admin/team-activity/waiting
router.get('/waiting', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await waitingBoard(req.user)) });
}));

// GET /admin/team-activity/performance?days=30
router.get('/performance', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await teamPerformance(req.user, { days: req.query.days })) });
}));

// GET /admin/team-activity/orders/:id
router.get('/orders/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Order not found.' });
  res.json({ success: true, ...(await orderTimeline(req.user, req.params.id)) });
}));

export default router;
