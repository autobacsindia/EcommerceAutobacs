import mongoose from 'mongoose';
import CampaignProductTier from '../models/CampaignProductTier.js';

/**
 * Data access for materialized product-tier membership.
 *
 * Two very different read shapes, and the split is deliberate:
 *   - the PRICING read (`findForProducts`) is keyed on the cart's product ids, so it is
 *     bounded by cart size and served entirely by the unique {campaign, product} index;
 *   - the ADMIN read (`listPage`) is keyset-paginated over a collection that only grows.
 * Neither uses skip/offset.
 */
class CampaignProductTierRepository {
  /**
   * PRICING PATH: the tier assignment for the products in one cart.
   *
   * Returns a Map<productId, row> so the caller resolves each line with a lookup rather
   * than a scan. A product with no row is not an error — it means "everything else", and
   * the default tier applies. Accepts a session so it can join the checkout transaction
   * and read the same snapshot the rest of the recompute does.
   */
  async findForProducts(campaignId, productIds, session = null) {
    const ids = (productIds || [])
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(String(id)));
    if (ids.length === 0) return new Map();

    let q = CampaignProductTier
      .find({ campaign: campaignId, product: { $in: ids } })
      .select('product tierCode matchedCodes')
      .lean();
    if (session) q = q.session(session);

    const rows = await q;
    return new Map(rows.map(r => [String(r.product), r]));
  }

  /**
   * Commit an assignment. Idempotent: upserts on the unique {campaign, product} key, so
   * re-running the same query preview produces no duplicates and no churn.
   *
   * `preserveManual` defaults true — an operator who has hand-placed a product must not
   * have that silently reverted the next time someone re-runs the authoring query. The
   * guard lives in the filter, so it is atomic rather than a read-then-decide.
   */
  async assign(campaignId, rows, { assignedBy = null, preserveManual = true } = {}) {
    const ops = (rows || []).map(row => {
      const filter = { campaign: campaignId, product: row.product };
      if (preserveManual && row.source !== 'manual') filter.source = { $ne: 'manual' };
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              tierCode: row.tierCode,
              matchedCodes: row.matchedCodes || [row.tierCode],
              matchedQueries: row.matchedQueries || [],
              source: row.source || 'query',
              assignedBy,
            },
            $setOnInsert: { campaign: campaignId, product: row.product },
          },
          upsert: true,
        },
      };
    });
    if (ops.length === 0) return { assigned: 0, updated: 0, skipped: 0 };

    // `ordered: false` so one conflicting row cannot abandon the rest of the batch. A
    // duplicate-key error here is the expected outcome of the preserveManual guard —
    // the filter misses, the upsert tries to insert, and the unique index refuses it.
    let res;
    try {
      res = await CampaignProductTier.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (err?.code !== 11000 && !err?.writeErrors?.length) throw err;
      res = err.result || {};
    }
    const assigned = res.upsertedCount || res.nUpserted || 0;
    const updated = res.modifiedCount || res.nModified || 0;
    return { assigned, updated, skipped: ops.length - assigned - updated };
  }

  /** Per-tier product counts for the admin screen. */
  async countsByTier(campaignId) {
    const rows = await CampaignProductTier.aggregate([
      { $match: { campaign: new mongoose.Types.ObjectId(String(campaignId)) } },
      { $group: { _id: '$tierCode', count: { $sum: 1 } } },
    ]);
    return rows.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
  }

  /**
   * ADMIN PATH: one keyset page of a campaign's assignments, optionally one tier.
   * Ordered by `product` because that is the unique key the cursor walks — an ordering
   * on a non-unique field would skip or repeat rows as the collection changes.
   */
  async listPage(campaignId, { cursor = null, limit = 50, tierCode = null } = {}) {
    const filter = { campaign: campaignId };
    if (tierCode) filter.tierCode = tierCode;
    if (cursor && mongoose.isValidObjectId(cursor)) {
      filter.product = { $gt: new mongoose.Types.ObjectId(String(cursor)) };
    }

    const capped = Math.min(Math.max(1, Number(limit) || 50), 100);
    const rows = await CampaignProductTier.find(filter)
      .sort({ product: 1 })
      .limit(capped + 1)
      .select('product tierCode matchedCodes matchedQueries source updatedAt')
      .populate('product', 'name slug price originalPrice saleEndsAt brand images')
      .lean();

    const hasMore = rows.length > capped;
    const page = hasMore ? rows.slice(0, capped) : rows;
    return {
      rows: page,
      // The cursor is the raw product id, which survives the populate above replacing
      // the field with a document — read it back off either shape.
      nextCursor: hasMore ? String(page[page.length - 1].product?._id || page[page.length - 1].product) : null,
    };
  }

  /**
   * Drop a single product's assignment — used when the last tier it matched is removed,
   * so it falls back to the default rather than keeping a stale code.
   */
  async removeProduct(campaignId, productId) {
    const res = await CampaignProductTier.deleteOne({ campaign: campaignId, product: productId });
    return res.deletedCount || 0;
  }

  /** Drop one tier's assignments (re-authoring a tier from scratch). */
  async removeTier(campaignId, tierCode) {
    const res = await CampaignProductTier.deleteMany({ campaign: campaignId, tierCode });
    return res.deletedCount || 0;
  }

  /**
   * Drop a whole campaign's assignments.
   *
   * Only for re-authoring, NOT for switching campaigns — a campaign is deactivated by
   * flipping its status, which leaves these rows intact as the record of what priced a
   * historical order. Bounded by design: a campaign holds hundreds of rows, not the
   * millions that would make deleteMany the wrong tool.
   */
  async removeCampaign(campaignId) {
    const res = await CampaignProductTier.deleteMany({ campaign: campaignId });
    return res.deletedCount || 0;
  }
}

export default new CampaignProductTierRepository();
