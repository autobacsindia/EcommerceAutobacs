/**
 * Margins (admin only) — /api/v1/admin/margins
 *
 *   GET /admin/margins/settings                               the minimum margin %
 *   PUT /admin/margins/settings { minPct }                    change it (new payments only)
 *   GET /admin/margins/totals?from&to                         sale, cost, margin over a range
 *   GET /admin/margins/lines?from&to&sort=newest|lowest&below=1&cursor
 *   GET /admin/margins/products?from&to&sort=lowest|sale&cursor
 *   GET /admin/margins/exceptions?cursor                      below-margin supplier payments
 *
 * Dates are India days, YYYY-MM-DD. Every list is cursor paged and bounded.
 * Company money: `protect` → 401, `admin` → 403 for staff and customers.
 */
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import * as margins from '../services/supplierMarginService.js';

const router = express.Router();
router.use('/margins', protect, admin, (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/margins/settings', asyncHandler(async (req, res) => {
  res.json({ success: true, settings: await margins.settings(req.user) });
}));
router.put('/margins/settings', asyncHandler(async (req, res) => {
  res.json({ success: true, settings: await margins.setSettings(req.user, req.body || {}, req) });
}));
router.get('/margins/totals', asyncHandler(async (req, res) => {
  res.json({ success: true, totals: await margins.totals(req.user, req.query) });
}));
router.get('/margins/lines', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await margins.lines(req.user, req.query)) });
}));
router.get('/margins/products', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await margins.products(req.user, req.query)) });
}));
router.get('/margins/exceptions', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await margins.exceptions(req.user, req.query)) });
}));

export default router;
