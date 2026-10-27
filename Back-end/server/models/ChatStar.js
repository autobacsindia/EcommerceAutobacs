import mongoose from 'mongoose';

/**
 * A message someone starred to come back to ("Starred" in team chat). Private
 * to that person: nobody else ever sees who starred what.
 *
 * `channel` is kept so the Starred list can drop messages from conversations
 * the person can no longer read without loading each one first.
 */
const ChatStarSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One star per person per message — starring twice (a retry) is one star — and
// "which of these messages have I starred" for a page of messages.
ChatStarSchema.index({ user: 1, message: 1 }, { unique: true });
// The Starred list: newest first, keyset on _id.
ChatStarSchema.index({ user: 1, _id: -1 });

export default mongoose.models.ChatStar || mongoose.model('ChatStar', ChatStarSchema);
