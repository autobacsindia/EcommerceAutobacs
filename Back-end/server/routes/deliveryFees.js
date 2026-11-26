/**
 * Delivery fees (rate card + remote PINs). The public read is one shared, cached
 * document (display only); admin routes are admin-only because they change what
 * every customer is charged, and are guarded in-route (the router sits under the
 * public browsing limiter, like /festival-offer).
 */
import express from 'express';
import { query } from 'express-validator';
import { validateRequest } from '../middleware/validateRequest.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import {
  getPublicDeliveryFees,
  getCardFeeWaivers,
  getDeliveryEstimates,
  getDeliveryFeeAdmin,
  updateDeliveryFeeAdmin,
  listRemotePins,
  addRemotePins,
  removeRemotePins,
} from '../controllers/deliveryFeeController.js';

const router = express.Router();

router.get('/public', cacheMiddleware('static-data'), asyncHandler(getPublicDeliveryFees));

// One request per product grid (ids capped at MAX_CARD_FEE_IDS in the service).
router.get(
  '/card-waivers',
  query('ids').optional().isString().isLength({ max: 2000 }).withMessage('Too many product ids in one request'),
  validateRequest,
  asyncHandler(getCardFeeWaivers),
);

// Delivery window per product (PDP + cards). Display only; one request per grid.
router.get(
  '/estimates',
  query('ids').optional().isString().isLength({ max: 2000 }).withMessage('Too many product ids in one request'),
  validateRequest,
  asyncHandler(getDeliveryEstimates),
);

router.get('/admin', protect, admin, asyncHandler(getDeliveryFeeAdmin));
router.put('/admin', protect, admin, asyncHandler(updateDeliveryFeeAdmin));
router.get('/admin/remote-pins', protect, admin, asyncHandler(listRemotePins));
router.post('/admin/remote-pins', protect, admin, asyncHandler(addRemotePins));
router.post('/admin/remote-pins/remove', protect, admin, asyncHandler(removeRemotePins));

export default router;
