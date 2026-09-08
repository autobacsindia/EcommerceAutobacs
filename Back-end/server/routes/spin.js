/**
 * Spin-to-Win domain — the post-purchase reward wheel.
 *
 * Customer routes are authenticated and ownership-checked in the controller: order ids
 * are enumerable, so "logged in" is not sufficient to spin a given order.
 *
 * Admin sub-routes sit under an explicit "/admin" prefix and are declared FIRST, so no
 * literal path can ever fall through to a customer handler.
 *
 * One exception to both rules: GET /public/live is unauthenticated and cached — it is
 * the home hero's teaser, carries its own public limiter, and returns a redacted prize
 * list with no ids, stock or odds in it. Everything else is per-order or per-admin and
 * is not cached at the edge.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { spinRateLimit } from '../middleware/rate-limit/index.js';
import { publicBrowsingRateLimit } from '../middleware/rate-limit/ecommerceLimiters.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getSpinStatus,
  postSpin,
  postReviewClicked,
  listCampaigns,
  createCampaign,
  updateCampaign,
  publishCampaign,
  setCampaignStatus,
  cloneCampaign,
  getOdds,
  listPrizes,
  createPrize,
  updatePrize,
  deactivatePrize,
  listWinners,
  fulfilWinner,
  getPublicLiveCampaign,
} from '../controllers/spinController.js';
import {
  validateOrderIdParam,
  validateCampaignIdParam,
  validatePrizeIdParam,
  validateSpinResultIdParam,
  validateCreateCampaign,
  validateUpdateCampaign,
  validateCampaignStatus,
  validateCloneCampaign,
  validateCreatePrize,
  validateUpdatePrize,
  validateWinnerList,
} from '../validators/spin.validator.js';

const router = express.Router();

// ── Public ──────────────────────────────────────────────────────────────────
// The one unauthenticated route in this router: the home hero reads it to decide
// whether to show the Spin-to-Win slide and which prizes to draw on the wheel.
// Every other route here is authenticated and inherits no public limiter from
// routes/index.js, so this one carries its own.
router.get('/public/live', publicBrowsingRateLimit, asyncHandler(getPublicLiveCampaign));

// ── Admin: campaigns ────────────────────────────────────────────────────────
router.get('/admin/campaigns', protect, admin, asyncHandler(listCampaigns));
router.post('/admin/campaigns', protect, admin, validateCreateCampaign, validateRequest, asyncHandler(createCampaign));
router.put('/admin/campaigns/:id', protect, admin, validateUpdateCampaign, validateRequest, asyncHandler(updateCampaign));
router.post('/admin/campaigns/:id/publish', protect, admin, validateCampaignIdParam, validateRequest, asyncHandler(publishCampaign));
router.patch('/admin/campaigns/:id/status', protect, admin, validateCampaignStatus, validateRequest, asyncHandler(setCampaignStatus));
// Opening a new window: clone, never date-edit the old row (see cloneCampaign).
router.post('/admin/campaigns/:id/clone', protect, admin, validateCloneCampaign, validateRequest, asyncHandler(cloneCampaign));
router.get('/admin/campaigns/:id/odds', protect, admin, validateCampaignIdParam, validateRequest, asyncHandler(getOdds));

// ── Admin: prizes ───────────────────────────────────────────────────────────
router.get('/admin/campaigns/:id/prizes', protect, admin, validateCampaignIdParam, validateRequest, asyncHandler(listPrizes));
router.post('/admin/campaigns/:id/prizes', protect, admin, validateCreatePrize, validateRequest, asyncHandler(createPrize));
router.put('/admin/prizes/:prizeId', protect, admin, validateUpdatePrize, validateRequest, asyncHandler(updatePrize));
router.delete('/admin/prizes/:prizeId', protect, admin, validatePrizeIdParam, validateRequest, asyncHandler(deactivatePrize));

// ── Admin: fulfilment queue ─────────────────────────────────────────────────
router.get('/admin/winners', protect, admin, validateWinnerList, validateRequest, asyncHandler(listWinners));
router.patch('/admin/winners/:id/fulfil', protect, admin, validateSpinResultIdParam, validateRequest, asyncHandler(fulfilWinner));

// ── Customer ────────────────────────────────────────────────────────────────
router.get('/orders/:orderId', protect, validateOrderIdParam, validateRequest, asyncHandler(getSpinStatus));
router.post('/orders/:orderId', protect, spinRateLimit, validateOrderIdParam, validateRequest, asyncHandler(postSpin));
router.post('/orders/:orderId/review-clicked', protect, validateOrderIdParam, validateRequest, asyncHandler(postReviewClicked));

export default router;
