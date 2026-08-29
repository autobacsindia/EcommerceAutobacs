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
   * Has anyone actually spun this campaign? Used to decide whether reopening a closed
   * window would be unfair (see spinController.updateCampaign).
   */
  async countGrantedForCampaign(campaignId) {
    return SpinResult.countDocuments({
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

  /** Create the spin record inside the draw transaction. */
  async createInSession(doc, session) {
    const [created] = await SpinResult.create([doc], { session });
    return created;
  }

  /**
   * Atomically flip granted → void. THE clawback idempotency guard: only the caller
   * that wins this transition proceeds to return stock, so a retried status change
   * cannot credit the same unit twice.
   */
  async markVoid(orderId, reason, session = null) {
    return SpinResult.findOneAndUpdate(
      { order: orderId, status: SPIN_RESULT_STATUS.GRANTED },
      { $set: { status: SPIN_RESULT_STATUS.VOID, voidReason: reason, voidedAt: new Date() } },
      { new: true, session },
    );
  }

  async save(doc, session = null) {
    return doc.save({ session });
  }

  async findDocById(id) {
    return SpinResult.findById(id);
  }

  async findLeanById(id) {
    return SpinResult.findById(id).lean();
  }

  /** Record the Google-review click. Analytics only — never gates a prize. */
  async markReviewClicked(orderId) {
    return SpinResult.updateOne(
      { order: orderId, reviewCtaClickedAt: null },
      { $set: { reviewCtaClickedAt: new Date() } },
    );
  }

  /**
   * Claim the "packed it" tick. Conditional on fulfilledAt being unset so two admins
   * clicking at once record one fulfilment by one person.
   */
  async claimFulfilment(resultId, adminId) {
    return SpinResult.findOneAndUpdate(
      { _id: resultId, fulfilledAt: null },
      { $set: { fulfilledAt: new Date(), fulfilledBy: adminId } },
      { new: true },
    );
  }

  /** Stamp the prize-email idempotency flag. Set only after the provider accepts. */
  async markPrizeEmailed(resultId) {
    return SpinResult.updateOne({ _id: resultId }, { $set: { prizeEmailedAt: new Date() } });
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
