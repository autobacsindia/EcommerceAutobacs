/** /api/v1/hr/settings — company HR settings (HR/admin). */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import { hrOrAdmin } from '../../middleware/hrAuth.js';
import { getHrSettings, updateHrSettings } from '../../services/hr/settings.js';

const router = express.Router();

router.get('/settings', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, settings: await getHrSettings() });
}));

router.patch('/settings', hrOrAdmin, asyncHandler(async (req, res) => {
  const { rev, reason, ...input } = req.body || {};
  res.json({ success: true, settings: await updateHrSettings(req.user, input, { rev, reason, req }) });
}));

export default router;
