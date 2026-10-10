import mongoose from 'mongoose';

/**
 * One chat message. Business records: never hard-deleted. A delete sets
 * `deletedAt` and the API stops returning the text, but the row stays for audit.
 */
const ChatMessageSchema = new mongoose.Schema(
  {
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    seq: { type: Number, required: true },
    kind: { type: String, enum: ['user', 'system'], default: 'user' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for system posts
    text: { type: String, required: true, maxlength: 4000 },
    // Client-generated id per send attempt. A retried or double-clicked send
    // carries the same id, and the unique index below turns it into one message.
    clientId: { type: String, default: undefined },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ channel: 1, seq: -1 }, { unique: true });
ChatMessageSchema.index(
  { channel: 1, sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

export default mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);
