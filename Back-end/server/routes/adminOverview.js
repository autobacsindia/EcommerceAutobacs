import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { companyOverview } from '../services/adminOverviewService.js';

/**
 * Admin Company overview (/api/v1/admin/overview): teams, people, money waiting,
 * today's numbers and the activity feed. Admins only; read-only; never cached.
 */
const router = express.Router();
router.use(protect, admin);

router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ success: true, ...(await companyOverview(req.user)) });
}));

export default router;
