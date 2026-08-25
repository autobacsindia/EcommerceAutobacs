import BaseRepository from './baseRepository.js';
import SpinResult from '../models/SpinResult.js';
import { SPIN_RESULT_STATUS } from '../config/spin.js';

/** SpinResult data access — the immutable per-order record of a spin. */
class SpinResultRepository extends BaseRepository {
  constructor() {
    super(SpinResult);
  }

  async findByOrder(orderId, session = null) {
    let q = SpinResult.findOne({ order: orderId });
    if (session) q = q.session(session);
    return q.lean();
  }

  /** Per-user campaign cap: only granted spins count, voided ones are given back. */
  async countGrantedForUser(userId, campaignId) {
    return SpinResult.countDocuments({
      user: userId,
      campaign: campaignId,
      status: SPIN_RESULT_STATUS.GRANTED,
    });
  }

  /**
   * The admin fulfilment queue — granted, physical, not yet packed.
   *
   * Cursor-paginated on spunAt: this collection only grows, and skip/offset both
   * degrades linearly and skips rows under concurrent writes.
   */
  async findFulfilmentQueue({ campaignId = null, fulfilled = false, limit = 50, before = null } = {}) {
    const query = {
      status: SPIN_RESULT_STATUS.GRANTED,
      'prizeSnapshot.kind': 'goodie',
      fulfilledAt: fulfilled ? { $ne: null } : null,
    };
    if (campaignId) query.campaign = campaignId;
    if (before) query.spunAt = { $lt: before };

    return SpinResult.find(query)
      .sort({ spunAt: -1 })
      .limit(limit)
      .populate('order', 'shippingAddress totalAmount status createdAt')
      .lean();
  }

  async countUnfulfilled(campaignId = null) {
    const query = {
      status: SPIN_RESULT_STATUS.GRANTED,
      'prizeSnapshot.kind': 'goodie',
      fulfilledAt: null,
    };
    if (campaignId) query.campaign = campaignId;
    return SpinResult.countDocuments(query);
  }
}

export default new SpinResultRepository();
