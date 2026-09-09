import BaseRepository from './baseRepository.js';
import AffiliatePayout from '../models/AffiliatePayout.js';

/**
 * AffiliatePayout data access.
 *
 * Thin on purpose: the interesting write — claiming an affiliate's approved commission
 * rows into a batch — belongs to affiliateCommissionRepository, because the ROWS are
 * the money and the row-level `payout: null` predicate is the concurrency guard. A
 * payout document is the receipt, not the ledger.
 */
class AffiliatePayoutRepository extends BaseRepository {
  constructor() {
    super(AffiliatePayout);
  }

  /** Create a batch inside the claim transaction. */
  async createInSession(doc, session) {
    const [payout] = await AffiliatePayout.create([doc], { session });
    return payout;
  }

  /** One batch, with the affiliate resolved for display. */
  async findByIdPopulated(payoutId) {
    return AffiliatePayout.findById(payoutId).populate('affiliate', 'code name email');
  }

  /** Paid batches in a date range — the TDS export's source. */
  async findPaidBetween(from = null, to = null, status) {
    const query = { status };
    if (from || to) {
      query.paidAt = {};
      if (from) query.paidAt.$gte = new Date(from);
      if (to) query.paidAt.$lte = new Date(to);
    }
    return AffiliatePayout.find(query).sort({ paidAt: 1 }).lean();
  }

  /** Persist computed totals onto a draft, inside the claim transaction. */
  async saveInSession(payout, session) {
    return payout.save({ session });
  }

  /** Admin queue / affiliate statement — keyset-paginated, newest first, bounded. */
  async findPage({ affiliate = null, status = null, limit = 50, before = null } = {}) {
    const query = {};
    if (affiliate) query.affiliate = affiliate;
    if (status) query.status = status;
    if (before) query.createdAt = { $lt: before };

    return AffiliatePayout.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('affiliate', 'code name email')
      .lean();
  }

  /**
   * Compare-and-set into a terminal state.
   *
   * Guarded on the set of states the transition is legal FROM, so two admins racing on
   * "mark paid" cannot both record a transfer, and a payout already marked failed
   * cannot be flipped to paid by a stale browser tab. The caller treats `false` as
   * "someone else already resolved this" and refreshes — the same 409 semantics the
   * batch builder uses.
   *
   * @returns {Promise<boolean>} true when THIS call made the transition
   */
  async transitionOnce(payoutId, fromStatuses, update, session = null) {
    const res = await AffiliatePayout.updateOne(
      { _id: payoutId, status: { $in: fromStatuses } },
      { $set: update },
      session ? { session } : {}
    );
    return res.modifiedCount === 1;
  }
}

export default new AffiliatePayoutRepository();
