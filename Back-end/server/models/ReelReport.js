import mongoose from 'mongoose';
import { REEL_REPORT_REASON_MAX } from '../config/reels.js';

/**
 * A viewer reporting a reel to staff. One report per person per reel (unique index),
 * so one angry account cannot pile up the count; the reel's `reportCount` moves only
 * when a new row is inserted.
 */
const ReelReportSchema = new mongoose.Schema({
  reel: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, trim: true, maxlength: REEL_REPORT_REASON_MAX, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

// Same name in config/db.js ensureCriticalIndexes.
ReelReportSchema.index({ reel: 1, user: 1 }, { unique: true, name: 'reel_report_reel_user' });

export default mongoose.models.ReelReport || mongoose.model('ReelReport', ReelReportSchema);
