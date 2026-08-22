import BaseRepository from './baseRepository.js';
import CouponRedemption from '../models/CouponRedemption.js';

class CouponRedemptionRepository extends BaseRepository {
  constructor() {
    super(CouponRedemption);
  }

  async findByOrder(orderId, session = null) {
    let q = CouponRedemption.findOne({ order: orderId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Redemption rows older than `cutoff`, oldest first — the driver for the stale-hold
   * sweep.
   *
   * Queried from THIS side rather than from Orders deliberately. A redemption row exists
   * only where a coupon was actually used, which is a small fraction of orders, so this
   * asks a short question instead of scanning every abandoned checkout for the rare one
   * that holds something.
   */
  async findStaleBefore(cutoff, limit = 500) {
    return CouponRedemption.find({ createdAt: { $lt: cutoff } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
  }

  async deleteByIdSession(id, session = null) {
    return CouponRedemption.deleteOne({ _id: id }, session ? { session } : {});
  }
}

export default new CouponRedemptionRepository();
