import mongoose from 'mongoose';
import {
  REEL_STATUS,
  REEL_STATUSES,
  REEL_CAPTION_MAX,
  REEL_REJECT_REASON_MAX,
} from '../config/reels.js';

/**
 * A shoppable reel: a short video tagging ONE product (config/reels.js).
 *
 * ⚠️ NO MONEY ON THIS DOCUMENT. It stores the product id only; price, MRP, rating and
 * availability are read live from the product whenever a reel is served, so editing a
 * price can never leave a reel advertising the old one, and checkout keeps recomputing
 * every figure exactly as for any other cart.
 *
 * Video bytes live in Cloudinary. Only the public id (and the facts we verified about
 * the asset before accepting it) are stored; every playable URL is derived from the
 * public id at read time (utils/reelMedia.js).
 *
 * Counters: `likeCount` and `reportCount` are maintained by the repository alongside
 * the unique ReelLike / ReelReport rows, which are the truth. Views are NOT here — they
 * are a Redis counter (house rule: no per-request Mongo writes).
 */
const ReelMediaSchema = new mongoose.Schema({
  publicId: { type: String, required: true, trim: true },
  version: { type: Number },
  format: { type: String, trim: true },
  durationSec: { type: Number, required: true, min: 0 },
  bytes: { type: Number, min: 0 },
  width: { type: Number, min: 0 },
  height: { type: Number, min: 0 },
}, { _id: false });

const ReelSchema = new mongoose.Schema({
  // Who gets credit (and, if they are an active affiliate, commission). Null for a
  // team upload that names nobody — the feed then shows the store as the creator.
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Who actually performed the upload (the creator, or a staff member for team uploads).
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: String, enum: ['customer', 'team'], required: true, default: 'customer' },

  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  media: { type: ReelMediaSchema, required: true },
  caption: { type: String, trim: true, maxlength: REEL_CAPTION_MAX, default: '' },

  status: { type: String, enum: REEL_STATUSES, required: true, default: REEL_STATUS.PENDING },
  rejectReason: { type: String, trim: true, maxlength: REEL_REJECT_REASON_MAX, default: null },
  moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  moderatedAt: { type: Date, default: null },
  // Feed sort key. Set on (re-)approval; the feed orders by it, newest first.
  approvedAt: { type: Date, default: null },

  likeCount: { type: Number, default: 0, min: 0 },
  reportCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });

// Same names in config/db.js ensureCriticalIndexes, which builds them in prod
// (autoIndex is off there).
//
// reel_feed: the public feed — status equality, then the (approvedAt, _id) keyset cursor.
ReelSchema.index({ status: 1, approvedAt: -1, _id: -1 }, { name: 'reel_feed' });
// reel_status_queue: the admin queue — status equality, newest uploads first.
ReelSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'reel_status_queue' });
// reel_creator_recent: "My reels".
ReelSchema.index({ creator: 1, createdAt: -1, _id: -1 }, { name: 'reel_creator_recent' });
// reel_public_id: one reel per uploaded asset — makes POST /reels idempotent under a
// double-tap or a retried request, and stops one asset being claimed twice.
ReelSchema.index({ 'media.publicId': 1 }, { unique: true, name: 'reel_public_id' });

export default mongoose.models.Reel || mongoose.model('Reel', ReelSchema);
