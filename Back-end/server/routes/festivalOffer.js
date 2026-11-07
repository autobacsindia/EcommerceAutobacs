/**
 * Festival (Diwali) price offer — on/off switch and date window.
 * Public read is one shared document (static-data cache, display only); admin routes
 * are guarded in-route because the router sits under the public browsing limiter.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, adminOrMarketing } from '../middleware/authMiddleware.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getActiveFestivalOffer,
  getFestivalOfferAdmin,
  updateFestivalOfferAdmin,
} from '../controllers/festivalOfferController.js';
import { validateUpdateFestivalOffer } from '../validators/festivalOffer.validator.js';

const router = express.Router();

router.get('/admin', protect, adminOrMarketing, asyncHandler(getFestivalOfferAdmin));
router.put(
  '/admin',
  protect, adminOrMarketing,
  validateUpdateFestivalOffer, validateRequest,
  asyncHandler(updateFestivalOfferAdmin),
);

router.get('/active', cacheMiddleware('static-data'), asyncHandler(getActiveFestivalOffer));

export default router;
