import BaseRepository from './baseRepository.js';
import CampaignMember from '../models/CampaignMember.js';
import { CAMPAIGN_MEMBER_STATUS } from '../config/campaign.js';

class CampaignMemberRepository extends BaseRepository {
  constructor() {
    super(CampaignMember);
  }

  /** The eligibility lookup: is this email on the campaign's allowlist? */
  async findByCampaignEmail(campaignId, email, session = null) {
    let q = CampaignMember.findOne({
      campaign: campaignId,
      email: String(email || '').toLowerCase().trim(),
    });
    if (session) q = q.session(session);
    return q;
  }

  async findByCampaignUser(campaignId, userId, session = null) {
    let q = CampaignMember.findOne({ campaign: campaignId, user: userId });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Bind an invite to the account that proved control of the address.
   * Idempotent — re-claiming leaves the original claimedAt intact, so a customer
   * revisiting the landing page does not rewrite their own history.
   */
  async claimForUser(campaignId, email, userId, session = null) {
    // Aggregation-pipeline update so binding the account and advancing the status
    // happen in ONE atomic write. A member who has already redeemed keeps that
    // status (never demoted to 'claimed'), and claimedAt records only the first
    // claim — a customer revisiting the landing page must not rewrite their history.
    return CampaignMember.findOneAndUpdate(
      { campaign: campaignId, email: String(email || '').toLowerCase().trim() },
      [
        {
          $set: {
            user: userId,
            status: {
              $cond: [
                { $eq: ['$status', CAMPAIGN_MEMBER_STATUS.INVITED] },
                CAMPAIGN_MEMBER_STATUS.CLAIMED,
                '$status',
              ],
            },
            claimedAt: { $ifNull: ['$claimedAt', '$$NOW'] },
          },
        },
      ],
      { new: true, session }
    );
  }

  /**
   * Record a redemption against the invite. Reporting only — the authoritative
   * "once per customer" guard is the coupon's per-user counter, so this is a
   * denormalised write for the admin dashboard and must never gate a checkout.
   */
  async markRedeemed(campaignId, userId, { orderId, discountRupees, email }, session = null) {
    // Matches on the account OR the invited email. `user` is only populated once the
    // customer has passed through the eligibility endpoint, which is not guaranteed —
    // a buyer can reach checkout without that call ever firing, and the redemption
    // would then match no member row at all, leaving the funnel showing them as never
    // having claimed and ₹0 given away. Email is the stable key, since the allowlist
    // is keyed on it.
    const or = [{ user: userId }];
    if (email) or.push({ email: String(email).toLowerCase().trim() });

    return CampaignMember.findOneAndUpdate(
      { campaign: campaignId, $or: or },
      {
        $set: {
          status: CAMPAIGN_MEMBER_STATUS.REDEEMED,
          user: userId,               // backfill the link if it was never established
          redeemedOrder: orderId,
          redeemedAt: new Date(),
          discountRupees: Math.max(0, Number(discountRupees) || 0),
        },
      },
      { new: true, session }
    );
  }

  /** Reverse a redemption record when an order is cancelled or refunded. */
  async clearRedemption(campaignId, userId, session = null) {
    return CampaignMember.findOneAndUpdate(
      { campaign: campaignId, user: userId },
      {
        $set: {
          status: CAMPAIGN_MEMBER_STATUS.CLAIMED,
          redeemedOrder: null,
          redeemedAt: null,
          discountRupees: 0,
        },
      },
      { new: true, session }
    );
  }

  /**
   * Bulk-load an allowlist from an operations spreadsheet. Upserts so a re-import
   * corrects names without wiping claim/redemption history, and returns per-row
   * outcomes so the admin screen can report exactly what changed.
   *
   * Uses bulkWrite for one round-trip; no Elasticsearch involvement (campaign members
   * are not catalogue documents, so the product-sync invariant does not apply here).
   */
  async bulkUpsert(campaignId, entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { inserted: 0, updated: 0 };
    }
    const ops = entries.map(({ email, name, reviewNote }) => ({
      updateOne: {
        filter: { campaign: campaignId, email: String(email).toLowerCase().trim() },
        update: {
          $set: { name: name || null, reviewNote: reviewNote || null },
          $setOnInsert: {
            campaign: campaignId,
            email: String(email).toLowerCase().trim(),
            status: CAMPAIGN_MEMBER_STATUS.INVITED,
          },
        },
        upsert: true,
      },
    }));
    const res = await CampaignMember.bulkWrite(ops, { ordered: false });
    return {
      inserted: res.upsertedCount || 0,
      updated: res.modifiedCount || 0,
    };
  }

  /**
   * One page of the allowlist, for the admin roster.
   *
   * KEYSET pagination on `email`, not skip/offset: the roster is read while imports
   * and claims are landing, and an offset would duplicate or skip rows the moment a
   * document is inserted mid-scroll. `{campaign: 1, email: 1}` is unique, so email is
   * a total order with no tie-break needed and the cursor can never stall on a
   * duplicate — and the same index serves the sort, so this stays an index scan.
   *
   * `q` is a plain Mongo match, deliberately NOT Elasticsearch: this searches an
   * allowlist of a few hundred addresses that only an admin ever reads, it is already
   * bounded by the `campaign` equality, and there is no campaign index in ES. The
   * email side is anchored (`^`) so it uses the index; the name side cannot be, which
   * is the reason for the hard limit cap above it.
   */
  async listPage(campaignId, { cursor = null, limit = 50, status = null, q = null } = {}) {
    const filter = { campaign: campaignId };
    if (status) filter.status = status;
    if (cursor) filter.email = { $gt: String(cursor).toLowerCase().trim() };

    if (q) {
      // Escape the user's text — an admin pasting "a+b@x.com" or "(pvt)" must not
      // compile into a regex that throws or scans pathologically.
      const safe = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (safe) {
        filter.$or = [
          { email: { $regex: `^${safe}`, $options: 'i' } },
          { name: { $regex: safe, $options: 'i' } },
        ];
      }
    }

    // Ask for one more than requested: its presence is what tells the caller there is
    // another page, without a second count query that could disagree under writes.
    const capped = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = await CampaignMember.find(filter)
      .sort({ email: 1 })
      .limit(capped + 1)
      .select('email name status claimedAt redeemedAt redeemedOrder discountRupees reviewNote')
      .lean();

    const hasMore = rows.length > capped;
    const page = hasMore ? rows.slice(0, capped) : rows;
    return {
      members: page,
      nextCursor: hasMore ? page[page.length - 1].email : null,
    };
  }

  /** Funnel counts for the admin dashboard. */
  async statusCounts(campaignId) {
    const rows = await CampaignMember.aggregate([
      { $match: { campaign: campaignId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const out = { invited: 0, claimed: 0, redeemed: 0, total: 0 };
    for (const r of rows) {
      out[r._id] = r.n;
      out.total += r.n;
    }
    return out;
  }

  async countForCampaign(campaignId) {
    return CampaignMember.countDocuments({ campaign: campaignId });
  }
}

export default new CampaignMemberRepository();
