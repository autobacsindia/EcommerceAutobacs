import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getMyKarma, getMyKarmaHistory,
  getConfig, updateConfig, adjustUserKarma
} from '../controllers/loyaltyController.js';
import { validateLoyaltyConfig, validateKarmaAdjust } from '../validators/coupon.validator.js';

const router = express.Router();

// Storefront: signed-in buyer's balance + history.
router.get('/me', protect, getMyKarma);
router.get('/history', protect, getMyKarmaHistory);

// Admin: programme config + manual balance adjustments.
router.get('/config', protect, admin, getConfig);
router.put('/config', protect, admin, validateLoyaltyConfig, validateRequest, updateConfig);
router.post('/users/:userId/adjust', protect, admin, validateKarmaAdjust, validateRequest, adjustUserKarma);

export default router;
