import BaseRepository from './baseRepository.js';
import SpinPrize from '../models/SpinPrize.js';
import { formatIsoDateIST } from '../utils/datetime.js';

/**
 * SpinPrize data access — including the single most safety-critical write in the
 * feature: the guarded stock decrement.
 */
class SpinPrizeRepository extends BaseRepository {
  constructor() {
    super(SpinPrize);
  }

  /** Every prize on a campaign, for the admin screen and the publish gate. */
  async findByCampaign(campaignId, { activeOnly = false } = {}) {
    const query = { campaign: campaignId };
    if (activeOnly) query.active = true;
    return SpinPrize.find(query).sort({ sortOrder: 1, createdAt: 1 }).lean();
  }

  /**
   * Candidate prizes for a draw: active, in-stock (or unlimited), and affordable for
   * this order's value.
   *
   * NOTE this is the *candidate* pool, not a reservation. Stock read here is advisory
   * and may be stale by the time the draw picks — which is exactly why awarding goes
   * through claimUnit() below and treats a null return as "lost the race", instead of
   * trusting this read. A cached or stale count must never be able to award a unit.
   */
  async findEligiblePool(campaignId, orderValuePaise) {
    return SpinPrize.find({
      campaign: campaignId,
      active: true,
      minOrderValuePaise: { $lte: orderValuePaise },
      $or: [{ stockRemaining: null }, { stockRemaining: { $gt: 0 } }],
    })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
  }

  async createPrize(doc) {
    return SpinPrize.create(doc);
  }

  async createMany(docs) {
    return SpinPrize.insertMany(docs);
  }

  async findDocById(id) {
    return SpinPrize.findById(id);
  }

  async updateById(id, patch) {
    return SpinPrize.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  }

  async saveDoc(doc) {
    return doc.save();
  }

  async findFloorPrize(campaignId, session = null) {
    let q = SpinPrize.findOne({ campaign: campaignId, isFloorPrize: true, active: true });
    if (session) q = q.session(session);
    return q.lean();
  }

  async countFloorPrizes(campaignId) {
    return SpinPrize.countDocuments({ campaign: campaignId, isFloorPrize: true, active: true });
  }

  /**
   * ATOMICALLY claim one unit of a prize. Returns the updated doc, or null if the unit
   * could not be taken.
   *
   * This is the serialization point for the whole feature. It must never be split into
   * a read followed by a write: the read is stale the instant it returns, and two
   * concurrent spins would both see "1 remaining" and both award it. The filter and the
   * decrement are one document-level atomic operation, so exactly one of N concurrent
   * callers can win the last unit and the rest get null and re-draw.
   *
   * Null means one of three things, all handled identically by the caller (drop this
   * prize, re-draw): stock exhausted, the daily cap is closed, or the prize was
   * deactivated between pool-load and claim.
   *
   * Stock AND the daily cap are checked in the SAME operation, which is why capDate/
   * capCount live on this document rather than in a counters collection — across two
   * documents there would be a window where stock is taken but the cap check fails.
   *
   * `todayIST` comes from utils/datetime.js, never `new Date().toISOString()`. Railway
   * runs UTC, so a UTC-derived day would roll the cap at 05:30 IST — wrong in prod and
   * invisible in local dev.
   */
  async claimUnit(prizeId, session = null, now = new Date()) {
    const todayIST = formatIsoDateIST(now);

    return SpinPrize.findOneAndUpdate(
      {
        _id: prizeId,
        active: true,
        // Unlimited (null) stock always passes; finite stock must have a unit left.
        $and: [
          { $or: [{ stockRemaining: null }, { stockRemaining: { $gt: 0 } }] },
          {
            $or: [
              { maxWinsPerDay: null },              // uncapped
              { capDate: { $ne: todayIST } },       // first win of a new IST day
              { $expr: { $lt: ['$capCount', '$maxWinsPerDay'] } },
            ],
          },
        ],
      },
      [
        {
          $set: {
            // A null stockRemaining (unlimited) must stay null, not become -1.
            stockRemaining: {
              $cond: [
                { $eq: ['$stockRemaining', null] },
                null,
                { $subtract: ['$stockRemaining', 1] },
              ],
            },
            stockAwarded: { $add: [{ $ifNull: ['$stockAwarded', 0] }, 1] },
            // Same-day → increment; new day → restart the count at this win.
            capCount: {
              $cond: [{ $eq: ['$capDate', todayIST] }, { $add: [{ $ifNull: ['$capCount', 0] }, 1] }, 1],
            },
            capDate: todayIST,
          },
        },
      ],
      { new: true, session },
    ).lean();
  }

  /**
   * Return a claimed unit to stock — the clawback half of claimUnit.
   *
   * Deliberately does NOT decrement capCount: the daily cap limits how many units may
   * LEAVE per day, and a same-day cancellation should not free another expensive goodie
   * for someone else to win. Unlimited (null) stock stays null.
   */
  async releaseUnit(prizeId, session = null) {
    return SpinPrize.findOneAndUpdate(
      { _id: prizeId },
      [
        {
          $set: {
            stockRemaining: {
              $cond: [
                { $eq: ['$stockRemaining', null] },
                null,
                { $add: ['$stockRemaining', 1] },
              ],
            },
            stockAwarded: { $max: [0, { $subtract: [{ $ifNull: ['$stockAwarded', 0] }, 1] }] },
          },
        },
      ],
      { new: true, session },
    ).lean();
  }
}

export default new SpinPrizeRepository();
