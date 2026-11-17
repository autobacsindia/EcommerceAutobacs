/**
 * Delivery fees (rate card + remote PINs). The public read is one shared, cached
 * document (display only); admin routes are admin-only because they change what
 * every customer is charged, and are guarded in-route (the router sits under the
 * public browsing limiter, like /festival-offer).
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import {
  getPublicDeliveryFees,
  getDeliveryFeeAdmin,
  updateDeliveryFeeAdmin,
  listRemotePins,
  addRemotePins,
  removeRemotePins,
} from '../controllers/deliveryFeeController.js';

const router = express.Router();

router.get('/public', cacheMiddleware('static-data'), asyncHandler(getPublicDeliveryFees));

router.get('/admin', protect, admin, asyncHandler(getDeliveryFeeAdmin));
router.put('/admin', protect, admin, asyncHandler(updateDeliveryFeeAdmin));
router.get('/admin/remote-pins', protect, admin, asyncHandler(listRemotePins));
router.post('/admin/remote-pins', protect, admin, asyncHandler(addRemotePins));
router.post('/admin/remote-pins/remove', protect, admin, asyncHandler(removeRemotePins));

export default router;
