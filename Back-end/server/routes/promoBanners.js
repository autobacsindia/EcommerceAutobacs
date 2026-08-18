/**
 * Promo banner domain — the site-wide occasion strip (Onam, Diwali, sale).
 *
 * Public read is a single shared (non-personalised) document, so it carries
 * `static-data` cache-control for the CDN/browser and is served from Redis at the
 * origin. Admin CRUD is guarded in-route with protect + admin because the router
 * is mounted under the public browsing rate limit.
 *
 * Admin sub-routes are declared under an explicit "/admin" prefix so no literal
 * can ever collide with the public "/active" path.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getActiveBanner,
  listBanners,
  createBanner,
  updateBanner,
  toggleBanner,
  deleteBanner,
} from '../controllers/promoBannerController.js';
import {
  validatePromoBannerId,
  validatePromoBannerList,
  validateCreatePromoBanner,
  validateUpdatePromoBanner,
  validateTogglePromoBanner,
} from '../validators/promoBanner.validator.js';

const router = express.Router();

// ── Admin (declared first so "/admin" never falls through to a public handler) ──
router.get(
  '/admin',
  protect, admin,
  validatePromoBannerList, validateRequest,
  asyncHandler(listBanners),
);
router.post(
  '/admin',
  protect, admin,
  validateCreatePromoBanner, validateRequest,
  asyncHandler(createBanner),
);
router.put(
  '/admin/:id',
  protect, admin,
  validateUpdatePromoBanner, validateRequest,
  asyncHandler(updateBanner),
);
router.patch(
  '/admin/:id/toggle',
  protect, admin,
  validateTogglePromoBanner, validateRequest,
  asyncHandler(toggleBanner),
);
router.delete(
  '/admin/:id',
  protect, admin,
  validatePromoBannerId, validateRequest,
  asyncHandler(deleteBanner),
);

// ── Public ──
router.get('/active', cacheMiddleware('static-data'), asyncHandler(getActiveBanner));

export default router;
