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

  /**
   * One page of redemptions for a coupon, newest first — the admin campaign report.
   *
   * Reads THIS collection rather than CampaignMember, which is the roster and only
   * exists for an allowlist campaign: a public campaign never writes a member row, so
   * the roster shows an empty table while money is demonstrably going out the door.
   * A redemption row is written for every use of the managed coupon regardless of
   * audience, which makes it the only complete record of who redeemed.
   *
   * KEYSET pagination on `_id`, not skip/offset. Redemptions land while an admin is
   * scrolling — a checkout completing mid-page would shift an offset and silently
   * duplicate or skip a row. `_id` descending is also creation order, so "newest first"
   * needs no separate sort field, and it is unique, so the cursor can never stall on a
   * tie.
   */
  async listByCouponPage(couponId, { cursor = null, limit = 50 } = {}) {
    const filter = { coupon: couponId };
    // Strictly less-than the last id seen: the cursor row itself was already returned,
    // and `$lte` here is the classic off-by-one that repeats a row on every page turn.
    if (cursor) filter._id = { $lt: cursor };

    // One more than asked for. Its presence is what proves there is another page,
    // without a count query that could disagree with the page under concurrent writes.
    const capped = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = await CouponRedemption.find(filter)
      .sort({ _id: -1 })
      .limit(capped + 1)
      .select('user order code discountAmount createdAt')
      // Projected populates, not whole documents: this is a list, and the order doc in
      // particular carries items, addresses and payment history nobody here reads.
      .populate('user', 'name email')
      .populate('order', 'status paymentStatus totalAmount createdAt')
      .lean();

    const hasMore = rows.length > capped;
    const page = hasMore ? rows.slice(0, capped) : rows;
    return {
      redemptions: page,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    };
  }

  /**
   * Money actually taken versus money merely committed, for one coupon.
   *
   * The campaign's own `redeemedCount` is incremented inside the ORDER-CREATION
   * transaction, before a rupee has moved — it is the budget-cap mechanism, and it has
   * to behave that way or two simultaneous checkouts would both take the last slot. It
   * is therefore the wrong number to report as "customers who bought", and reading it
   * that way overstates a campaign by every abandoned checkout.
   *
   * Split by payment state rather than reduced to a single figure because the states
   * mean genuinely different things to whoever reads this: `paid` is realised, the
   * unpaid bucket may still convert, and `refunded` is money that came back. Note that
   * a refunded order KEEPS its redemption row unless the release path ran, so refunds
   * are reported separately instead of being quietly folded into the paid totals.
   */
  async statsByCoupon(couponId) {
    const rows = await CouponRedemption.aggregate([
      { $match: { coupon: couponId } },
      {
        $lookup: {
          from: 'orders', localField: 'order', foreignField: '_id', as: 'order',
          pipeline: [{ $project: { paymentStatus: 1, totalAmount: 1 } }],
        },
      },
      // An orphaned redemption (its order hard-deleted) must not vanish from the
      // totals — it is counted as unpaid rather than dropped by an inner join.
      { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$order.paymentStatus', 'pending'] },
          count: { $sum: 1 },
          discount: { $sum: '$discountAmount' },
          revenue: { $sum: { $ifNull: ['$order.totalAmount', 0] } },
        },
      },
    ]);

    const zero = { count: 0, discount: 0, revenue: 0 };
    const byStatus = Object.fromEntries(rows.map(r => [r._id, {
      count: r.count, discount: r.discount, revenue: r.revenue,
    }]));

    const paid = byStatus.paid || zero;
    const refunded = byStatus.refunded || zero;
    const unpaid = rows
      .filter(r => r._id !== 'paid' && r._id !== 'refunded')
      .reduce((a, r) => ({
        count: a.count + r.count, discount: a.discount + r.discount, revenue: 0,
      }), { ...zero });

    return {
      paid: { ...paid, avgOrderValue: paid.count ? paid.revenue / paid.count : 0 },
      unpaid: { count: unpaid.count, discount: unpaid.discount },
      refunded: { count: refunded.count, discount: refunded.discount },
      total: rows.reduce((a, r) => a + r.count, 0),
    };
  }

  async deleteByIdSession(id, session = null) {
    return CouponRedemption.deleteOne({ _id: id }, session ? { session } : {});
  }
}

export default new CouponRedemptionRepository();
