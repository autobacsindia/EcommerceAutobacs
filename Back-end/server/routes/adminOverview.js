import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { companyOverview } from '../services/adminOverviewService.js';

/**
 * Admin Company overview (/api/v1/admin/overview): teams, people, money waiting,
 * a day's numbers and the activity feed. Admins only; read-only; never cached.
 *
 * `?date=YYYY-MM-DD` (IST calendar day) looks back at a past day; omitted = today.
 * Future or invalid dates are a 400. Not cached: the past-day view is a handful of
 * indexed reads like today's, and it still carries live "now" queues, so a cached
 * copy would go stale exactly where the page says "now".
 */
const router = express.Router();
router.use(protect, admin);

router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...(await companyOverview(req.user, Date.now(), { date: req.query.date })) });
}));

export default router;
