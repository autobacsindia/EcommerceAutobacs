/**
 * Festival theme — the on/off switch and date window for festive decoration.
 * Public read is one shared document (static-data cache); admin routes are
 * guarded in-route because the router sits under the public browsing limiter.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, adminOrMarketing } from '../middleware/authMiddleware.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getActiveFestivalTheme,
  getFestivalThemeAdmin,
  updateFestivalThemeAdmin,
} from '../controllers/festivalThemeController.js';
import { validateUpdateFestivalTheme } from '../validators/festivalTheme.validator.js';

const router = express.Router();

router.get('/admin', protect, adminOrMarketing, asyncHandler(getFestivalThemeAdmin));
router.put(
  '/admin',
  protect, adminOrMarketing,
  validateUpdateFestivalTheme, validateRequest,
  asyncHandler(updateFestivalThemeAdmin),
);

router.get('/active', cacheMiddleware('static-data'), asyncHandler(getActiveFestivalTheme));

export default router;
