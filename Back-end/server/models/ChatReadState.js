import mongoose from 'mongoose';

/** How far a user has read in a channel. Unread = channel.lastMessageSeq - lastReadSeq. */
const ChatReadStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    lastReadSeq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ChatReadStateSchema.index({ user: 1, channel: 1 }, { unique: true });

export default mongoose.models.ChatReadState || mongoose.model('ChatReadState', ChatReadStateSchema);
