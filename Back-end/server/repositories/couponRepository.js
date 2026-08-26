import BaseRepository from './baseRepository.js';
import Coupon from '../models/Coupon.js';

class CouponRepository extends BaseRepository {
  constructor() {
    super(Coupon);
  }

  async findByCode(code, session = null) {
    let q = Coupon.findOne({ code });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Guarded global-usage increment: only succeeds while the coupon is active, in
   * date, and under its usage limit. Returns the updated coupon, or null if any gate
   * failed (e.g. the limit was reached by a concurrent checkout).
   */
  async incrementUsageGuarded(code, now, session) {
    return Coupon.findOneAndUpdate(
      {
        code,
        isActive: true,
        $and: [
          { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
          { $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }
        ]
      },
      { $inc: { usedCount: 1 } },
      { new: true, session }
    );
  }

  async decrementUsage(couponId, session = null) {
    return Coupon.updateOne(
      { _id: couponId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      session ? { session } : {}
    );
  }

  /** Active, public, in-date, not-globally-exhausted coupons for the discovery list. */
  /**
   * Mint a coupon inside a caller's transaction. Used by the Spin-to-Win draw so a
   * won coupon and the win itself commit together — a prize the customer can see but
   * cannot redeem is worse than no prize at all.
   */
  async createInSession(doc, session) {
    const [created] = await Coupon.create([doc], { session });
    return created;
  }

  async findAvailable(now) {
    return Coupon.find({
      isActive: true,
      visibility: 'public',
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
        { $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }
      ]
    })
      .select('code description type value maxDiscountAmount minCartValue expiresAt')
      .sort({ minCartValue: 1 })
      .lean();
  }
}

export default new CouponRepository();
