import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import * as suppliers from '../services/supplierService.js';

/**
 * The supplier directory (/api/v1/suppliers). Procurement and the admin add and
 * edit; accounts views. Who may do what is decided in services/supplierService.js.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
// Bank details: never cached by a browser or proxy.
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /suppliers?q=&status=active|inactive|all&after=
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await suppliers.list(req.user, req.query)) });
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, supplier: await suppliers.create(req.user, req.body, req) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.get(req.user, req.params.id) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.update(req.user, req.params.id, req.body, req) });
}));

// POST /suppliers/:id/active { active: boolean }
router.post('/:id/active', asyncHandler(async (req, res) => {
  res.json({ success: true, supplier: await suppliers.setActive(req.user, req.params.id, req.body?.active === true, req) });
}));

export default router;
