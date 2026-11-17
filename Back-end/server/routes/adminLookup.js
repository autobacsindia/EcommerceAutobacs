import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { lookup } from '../services/linkLookupService.js';

/**
 * Admin lookup (/api/v1/admin/lookup): type a project ID, an order number or
 * another ID; see its tasks, payments and linked orders / projects
 * (services/linkLookupService.js). Admins only; read-only; never cached.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, admin);

// GET /admin/lookup?q=PRJ-0007[&section=open|done|tasks|payments&cursor=]
router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const { q, section, cursor } = req.query;
  const str = (v) => (typeof v === 'string' ? v : undefined);
  res.json({ success: true, ...(await lookup(req.user, { q: str(q), section: str(section), cursor: str(cursor) })) });
}));

export default router;
