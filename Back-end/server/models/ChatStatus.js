import mongoose from 'mongoose';

/**
 * A person's team-chat status, as in Google Chat: "On leave", "In a meeting"…
 * shown beside their name to everyone who can chat. One row per person; it
 * clears itself at `until` (readers ignore an expired one, so nothing has to
 * run at that moment). Kept out of User so a status change never touches the
 * account document.
 */
const ChatStatusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 80 },
    until: { type: Date, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

ChatStatusSchema.index({ user: 1 }, { unique: true });

export default mongoose.models.ChatStatus || mongoose.model('ChatStatus', ChatStatusSchema);
