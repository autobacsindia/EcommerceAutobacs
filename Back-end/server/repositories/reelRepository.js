import mongoose from 'mongoose';
import Reel from '../models/Reel.js';
import ReelLike from '../models/ReelLike.js';
import ReelReport from '../models/ReelReport.js';

/**
 * Data access for shoppable reels (models/Reel.js, ReelLike.js, ReelReport.js).
 *
 * Every list read is a bounded keyset page (`after` = an `afterClause` from
 * utils/listQuery.js), lean, and projected to what a card needs.
 */

/** What any reel card needs. Never the whole document. */
const CARD_FIELDS = 'creator uploadedBy product media caption status rejectReason approvedAt likeCount reportCount source createdAt moderatedAt';

const isDuplicateKey = (err) => err?.code === 11000;

class ReelRepository {
  async create(doc) {
    const created = await Reel.create(doc);
    return created.toObject();
  }

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return Reel.findById(id).select(CARD_FIELDS).lean();
  }

  async findByPublicId(publicId) {
    return Reel.findOne({ 'media.publicId': publicId }).select(CARD_FIELDS).lean();
  }

  /**
   * One page of reels in `status`, ordered by `sortField` desc then _id desc.
   * `after` is the afterClause for the previous page's last row (or null).
   * Served by reel_feed (approvedAt) / reel_status_queue (createdAt).
   */
  async findPageByStatus({ status, sortField, after = null, limit }) {
    const query = after ? { status, ...after } : { status };
    return Reel.find(query)
      .select(CARD_FIELDS)
      .sort({ [sortField]: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  /** One page of a creator's own reels, any status, newest first (reel_creator_recent). */
  async findPageByCreator({ creator, after = null, limit }) {
    const query = after ? { creator, ...after } : { creator };
    return Reel.find(query)
      .select(CARD_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Move a reel between states ATOMICALLY: the update only matches while the reel is
   * still in one of `from`, so two moderators acting at once cannot both win, and an
   * illegal transition writes nothing. Returns the updated reel, or null.
   */
  async transition(id, from, set) {
    if (!mongoose.isValidObjectId(id)) return null;
    return Reel.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: set },
      { new: true, projection: CARD_FIELDS },
    ).lean();
  }

  /**
   * Like, idempotently. The unique (reel, user) row is the truth; the counter moves
   * only when a row is genuinely inserted, so a double tap or retry is one like.
   * @returns {Promise<boolean>} true when this call created the like
   */
  async like(reelId, userId, at = new Date()) {
    let inserted = false;
    try {
      const res = await ReelLike.updateOne(
        { reel: reelId, user: userId },
        { $setOnInsert: { reel: reelId, user: userId, createdAt: at } },
        { upsert: true },
      );
      inserted = res.upsertedCount === 1;
    } catch (err) {
      // Two concurrent upserts can both miss and race on the unique index; the
      // loser lands here. The like exists — this call just did not create it.
      if (!isDuplicateKey(err)) throw err;
    }
    if (inserted) await Reel.updateOne({ _id: reelId }, { $inc: { likeCount: 1 } });
    return inserted;
  }

  /** Unlike, idempotently. @returns {Promise<boolean>} true when a like was removed */
  async unlike(reelId, userId) {
    const res = await ReelLike.deleteOne({ reel: reelId, user: userId });
    if (res.deletedCount !== 1) return false;
    // Guarded so a counter that ever drifted can never go negative.
    await Reel.updateOne({ _id: reelId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
    return true;
  }

  async likeCount(reelId) {
    const row = await Reel.findById(reelId).select('likeCount').lean();
    return row?.likeCount ?? 0;
  }

  /** The subset of `reelIds` this user has liked — one indexed read for a whole page. */
  async likedReelIds(userId, reelIds) {
    if (!userId || !reelIds?.length) return new Set();
    const rows = await ReelLike.find({ reel: { $in: reelIds }, user: userId })
      .select('reel')
      .limit(reelIds.length)
      .lean();
    return new Set(rows.map((r) => String(r.reel)));
  }

  /** Report, idempotently (one per person per reel). @returns {Promise<boolean>} created */
  async report(reelId, userId, reason, at = new Date()) {
    let inserted = false;
    try {
      const res = await ReelReport.updateOne(
        { reel: reelId, user: userId },
        { $setOnInsert: { reel: reelId, user: userId, reason, createdAt: at } },
        { upsert: true },
      );
      inserted = res.upsertedCount === 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    if (inserted) await Reel.updateOne({ _id: reelId }, { $inc: { reportCount: 1 } });
    return inserted;
  }
}

export default new ReelRepository();
