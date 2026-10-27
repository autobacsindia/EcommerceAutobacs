import mongoose from 'mongoose';

/**
 * How far a user has read in a channel — one position per tab, so reading Chat
 * never clears unread order updates and the other way round:
 *   lastReadSeq        — Chat (people's messages)
 *   lastReadUpdatesSeq — Order updates (automatic posts and replies in their threads)
 * A row from before the split has no lastReadUpdatesSeq; it then counts as
 * lastReadSeq, exactly what it meant before (chatRepository freezes that value
 * the first time either position moves).
 */
const ChatReadStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    lastReadSeq: { type: Number, default: 0 },
    lastReadUpdatesSeq: { type: Number, default: undefined },
  },
  { timestamps: true }
);

ChatReadStateSchema.index({ user: 1, channel: 1 }, { unique: true });

export default mongoose.models.ChatReadState || mongoose.model('ChatReadState', ChatReadStateSchema);
