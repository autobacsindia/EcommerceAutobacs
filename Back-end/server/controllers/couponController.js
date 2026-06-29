import { asyncHandler } from '../middleware/errorMiddleware.js';
import couponService from '../services/couponService.js';

// @desc    Public coupons a shopper can discover at checkout
// @route   GET /coupons/available
// @access  Public
export const getAvailableCoupons = asyncHandler(async (req, res) => {
  const coupons = await couponService.listAvailable();
  res.json({ success: true, coupons });
});

// @desc    List coupons (admin) with pagination + code search
// @route   GET /admin/coupons
// @access  Private/Admin
export const listCoupons = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const result = await couponService.listAdmin({ page: Number(page), limit: Number(limit), search });
  res.json({ success: true, ...result });
});

// @desc    Get a single coupon (admin)
// @route   GET /admin/coupons/:id
// @access  Private/Admin
export const getCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.getById(req.params.id);
  res.json({ success: true, coupon });
});

// @desc    Create a coupon
// @route   POST /admin/coupons
// @access  Private/Admin
export const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.create(req.body);
  res.status(201).json({ success: true, coupon });
});

// @desc    Update a coupon
// @route   PUT /admin/coupons/:id
// @access  Private/Admin
export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.update(req.params.id, req.body);
  res.json({ success: true, coupon });
});

// @desc    Delete a coupon
// @route   DELETE /admin/coupons/:id
// @access  Private/Admin
export const deleteCoupon = asyncHandler(async (req, res) => {
  await couponService.remove(req.params.id);
  res.json({ success: true, message: 'Coupon deleted' });
});
