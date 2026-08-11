import BaseRepository from './baseRepository.js';
import Campaign from '../models/Campaign.js';

class CampaignRepository extends BaseRepository {
  constructor() {
    super(Campaign);
  }

  async findBySlug(slug, session = null) {
    let q = Campaign.findOne({ slug: String(slug || '').toLowerCase().trim() });
    if (session) q = q.session(session);
    return q;
  }

  /** The campaign that owns a managed coupon code — the pricing-path lookup. */
  async findByCouponCode(code, session = null) {
    let q = Campaign.findOne({ couponCode: String(code || '').toUpperCase().trim() });
    if (session) q = q.session(session);
    return q;
  }

  async findById(id, session = null) {
    let q = Campaign.findById(id);
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Guarded redemption increment — the global budget stop.
   *
   * Only succeeds while the campaign is still under `maxRedemptions`; returns null if
   * a concurrent checkout took the last slot. Mirrors couponRepository's guarded $inc
   * so a capped campaign can never be oversold: counting redemption rows and comparing
   * would be a read-then-write, and two simultaneous payments would both pass it.
   *
   * `discountRupees` accumulates the payout total for the admin dashboard in the same
   * atomic operation, so the reported spend can never drift from the redemption count.
   */
  async incrementRedemptionGuarded(campaignId, discountRupees, session) {
    return Campaign.findOneAndUpdate(
      {
        _id: campaignId,
        $or: [
          { maxRedemptions: null },
          { $expr: { $lt: ['$redeemedCount', '$maxRedemptions'] } },
        ],
      },
      {
        $inc: {
          redeemedCount: 1,
          discountGivenRupees: Math.max(0, Number(discountRupees) || 0),
        },
      },
      { new: true, session }
    );
  }

  /** Reverse a redemption when an order is cancelled or refunded. */
  async decrementRedemption(campaignId, discountRupees, session = null) {
    return Campaign.updateOne(
      { _id: campaignId, redeemedCount: { $gt: 0 } },
      {
        $inc: {
          redeemedCount: -1,
          discountGivenRupees: -Math.max(0, Number(discountRupees) || 0),
        },
      },
      session ? { session } : {}
    );
  }

  async listAdmin({ limit = 50 } = {}) {
    return Campaign.find({})
      .select('slug name status audience startsAt endsAt couponCode maxRedemptions redeemedCount discountGivenRupees updatedAt')
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, limit)))
      .lean();
  }
}

export default new CampaignRepository();
