import CouponUserUsage from '../models/CouponUserUsage.js';

class CouponUserUsageRepository {
  async findByCouponUser(couponId, userId, session = null) {
    let q = CouponUserUsage.findOne({ coupon: couponId, user: userId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Guarded per-user increment. Increments while under the limit; if the user is
   * already at the cap the filter misses and the upsert attempts an insert that
   * hits the unique {coupon,user} index → throws E11000 for the caller to map to a
   * "limit reached" error. Atomic, no TOCTOU.
   */
  async incrementGuarded(couponId, userId, limit, session) {
    return CouponUserUsage.findOneAndUpdate(
      { coupon: couponId, user: userId, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { coupon: couponId, user: userId } },
      { upsert: true, new: true, session }
    );
  }

  async decrement(couponId, userId, session = null) {
    return CouponUserUsage.updateOne(
      { coupon: couponId, user: userId, count: { $gt: 0 } },
      { $inc: { count: -1 } },
      session ? { session } : {}
    );
  }
}

export default new CouponUserUsageRepository();
