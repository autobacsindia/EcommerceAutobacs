import express from 'express';
import { protect, admin, adminOrMarketing } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  getAvailableCoupons, listCoupons, getCoupon,
  createCoupon, updateCoupon, deleteCoupon
} from '../controllers/couponController.js';
import {
  validateCouponCreate, validateCouponUpdate, validateCouponId
} from '../validators/coupon.validator.js';

const router = express.Router();

// Public: discover usable public coupons at checkout.
router.get('/available', getAvailableCoupons);

// Admin CRUD (every route guarded by protect + admin).
router.get('/', protect, adminOrMarketing, listCoupons);
router.post('/', protect, adminOrMarketing, validateCouponCreate, validateRequest, createCoupon);
router.get('/:id', protect, adminOrMarketing, validateCouponId, validateRequest, getCoupon);
router.put('/:id', protect, adminOrMarketing, validateCouponId, validateCouponUpdate, validateRequest, updateCoupon);
router.delete('/:id', protect, admin, validateCouponId, validateRequest, deleteCoupon);

export default router;
