import mongoose from 'mongoose';

/**
 * One like, by one person, on one reel. The unique index IS the idempotency: a second
 * like (double tap, retried request) cannot insert a second row, and the reel's
 * `likeCount` moves only when a row is actually inserted or deleted.
 */
const ReelLikeSchema = new mongoose.Schema({
  reel: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

// Also serves "which of these reels has this viewer liked" ({ reel: {$in}, user }).
// Same name in config/db.js ensureCriticalIndexes.
ReelLikeSchema.index({ reel: 1, user: 1 }, { unique: true, name: 'reel_like_reel_user' });

export default mongoose.models.ReelLike || mongoose.model('ReelLike', ReelLikeSchema);
