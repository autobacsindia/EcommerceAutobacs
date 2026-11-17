import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  adminList, adminCreate, adminUpdate, adminReset, previewSlip,
} from '../services/slipTemplateService.js';
import { renderProjectSlip } from '../services/projectSlipService.js';

/**
 * Admin → Slip templates (/api/v1/admin/slip-templates): the printable slips a
 * project offers in "Create slip" — add, change, hide, delete/restore, reset a
 * built-in one, and preview a draft as a PDF. Admins only; never cached.
 * Rules and checks: services/slipTemplateService.js.
 */
const router = express.Router();
router.use(protect, admin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET / — every template (deleted ones last) and what the editor may offer
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await adminList(req.user)) });
}));

// POST / { key, label, title, forms, fields, blocks, needs, declaration, signatures, active?, order? }
router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, template: await adminCreate(req.user, req.body, req) });
}));

// POST /preview { ...definition } — the draft as a PDF, filled with [Labels]; nothing saved
router.post('/preview', asyncHandler(async (req, res) => {
  const buffer = await renderProjectSlip(previewSlip(req.user, req.body));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Slip-preview.pdf"', 'Content-Length': buffer.length });
  res.send(buffer);
}));

// PATCH /:id { rev, ...definition } or { rev, archived }
router.patch('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, template: await adminUpdate(req.user, req.params.id, req.body, req) });
}));

// POST /:id/reset { rev } — a built-in slip back to how it shipped
router.post('/:id/reset', asyncHandler(async (req, res) => {
  res.json({ success: true, template: await adminReset(req.user, req.params.id, req.body, req) });
}));

export default router;
