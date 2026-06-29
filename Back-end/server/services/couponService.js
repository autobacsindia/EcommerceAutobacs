/**
 * Coupon service — admin CRUD, public listing, and redemption release.
 *
 * Pricing/eligibility maths lives in pricingService; this service owns the coupon
 * lifecycle. Release (on cancel/refund) reverses the atomic counters applied at
 * checkout and is idempotent via the CouponRedemption audit row.
 */

import mongoose from 'mongoose';
import couponRepository from '../repositories/couponRepository.js';
import couponRedemptionRepository from '../repositories/couponRedemptionRepository.js';
import couponUserUsageRepository from '../repositories/couponUserUsageRepository.js';
import AppError from '../utils/AppError.js';

const EDITABLE_FIELDS = [
  'code', 'description', 'type', 'value', 'maxDiscountAmount', 'visibility',
  'minCartValue', 'maxCartValue', 'startsAt', 'expiresAt', 'firstOrderOnly',
  'appliesTo', 'usageLimit', 'usageLimitPerUser', 'isActive'
];

function pick(body) {
  const out = {};
  for (const k of EDITABLE_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

// Tiny in-process cache for the public discovery list. Apply-time validation in
// pricingService is authoritative, so brief staleness only affects which coupons are
// *advertised* — never whether one actually applies. Invalidated on every admin write.
const AVAILABLE_TTL_MS = 60_000;
let availableCache = null;
let availableCachedAt = 0;
function invalidateAvailable() { availableCache = null; availableCachedAt = 0; }

class CouponService {
  async create(body) {
    const data = pick(body);
    if (!data.code) throw new AppError('Coupon code is required', 400);
    if (!data.type) throw new AppError('Coupon type is required', 400);
    try {
      const coupon = await couponRepository.create(data);
      invalidateAvailable();
      return coupon;
    } catch (err) {
      if (err?.code === 11000) throw new AppError('A coupon with this code already exists', 409);
      throw err;
    }
  }

  async update(id, body) {
    const coupon = await couponRepository.update(id, pick(body));
    if (!coupon) throw new AppError('Coupon not found', 404);
    invalidateAvailable();
    return coupon;
  }

  async remove(id) {
    const coupon = await couponRepository.delete(id);
    if (!coupon) throw new AppError('Coupon not found', 404);
    invalidateAvailable();
    return coupon;
  }

  async getById(id) {
    const coupon = await couponRepository.findById(id);
    if (!coupon) throw new AppError('Coupon not found', 404);
    return coupon;
  }

  async listAdmin({ page = 1, limit = 20, search } = {}) {
    const query = {};
    if (search) query.code = { $regex: String(search).trim().toUpperCase(), $options: 'i' };
    const skip = (Math.max(1, page) - 1) * limit;
    const [coupons, total] = await Promise.all([
      couponRepository.find(query, { skip, limit }),
      couponRepository.count(query)
    ]);
    return { coupons, total, page: Number(page), pages: Math.ceil(total / limit) };
  }

  /**
   * Public coupons a shopper could use right now: active, within their date window,
   * not globally exhausted. Cart-specific eligibility (min value, scope, per-user) is
   * still validated at apply time via pricingService — this is a discovery list only.
   */
  async listAvailable(now = new Date()) {
    if (availableCache && Date.now() - availableCachedAt < AVAILABLE_TTL_MS) return availableCache;
    const coupons = await couponRepository.findAvailable(now);
    availableCache = coupons;
    availableCachedAt = Date.now();
    return coupons;
  }

  /**
   * Release a coupon redemption when an order is cancelled/refunded before the
   * coupon should "stick". Idempotent: keyed on the audit row, which is deleted last.
   */
  async releaseForOrder(orderId) {
    const redemption = await couponRedemptionRepository.findByOrder(orderId);
    if (!redemption) return;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await couponRepository.decrementUsage(redemption.coupon, session);
        await couponUserUsageRepository.decrement(redemption.coupon, redemption.user, session);
        await couponRedemptionRepository.deleteByIdSession(redemption._id, session);
      });
    } finally {
      await session.endSession();
    }
    invalidateAvailable();
  }
}

export default new CouponService();
