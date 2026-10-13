import mongoose from 'mongoose';

/**
 * One attachment on a message. Stored in Cloudinary; we keep only the delivery
 * URL plus the public id needed to delete it later.
 */
const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    // 'image' renders inline; 'file' shows a download row. Decided server-side
    // from the verified MIME type, never from the client.
    kind: { type: String, enum: ['image', 'file'], required: true },
    name: { type: String, required: true, maxlength: 200 },
    mime: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * A business record mentioned in the message (today: orders). The code is the
 * ref the rest of the system already prints (invoiceService.orderNumber), so a
 * message reads the same as an email or an invoice.
 */
const RefSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['order'], required: true },
    code: { type: String, required: true, maxlength: 40 },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

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
    // Not required: a message may be attachments only. chatService enforces that
    // a message has text, files, or both.
    text: { type: String, default: '', maxlength: 4000 },
    // Client-generated id per send attempt. A retried or double-clicked send
    // carries the same id, and the unique index below turns it into one message.
    clientId: { type: String, default: undefined },
    attachments: { type: [AttachmentSchema], default: [] },
    // People directly addressed. Validated server-side against who can actually
    // see the channel, so a mention can never reveal a channel to an outsider.
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /** Teams addressed as a group, e.g. '@accounts'. Values from config/staff.js. */
    mentionTeams: [{ type: String }],
    refs: { type: [RefSchema], default: [] },
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

// Files tab: newest attachments in a channel. Partial so it indexes only the
// small subset of messages that actually carry a file.
ChatMessageSchema.index(
  { channel: 1, createdAt: -1 },
  { partialFilterExpression: { 'attachments.0': { $exists: true } } }
);
// "Mentions of me", newest first.
ChatMessageSchema.index({ mentions: 1, createdAt: -1 });

/*
  Message search.

  A text index rather than a regex: `text` grows without bound, and a regex
  over a chat history is a full collection scan per keystroke — the shape this
  repo already learned the hard way with catalogue search. Mongo's text index
  also gives stemming and quoted phrases, which is what people expect when they
  search "winch order" and mean the conversation, not the literal substring.

  Scoped to `text` alone: attachment file names and order codes are matched
  elsewhere (the Files tab, the order picker), and widening the index would
  make every file upload rewrite it.
*/
/*
  No companion { channel: 1, createdAt: -1 } index for the search sort. Two
  reasons, and the first alone settles it: Mongo cannot use a second index to
  sort the output of a $text match, so such an index would never be read on
  this query — it would only add write cost to every message. (It would also
  collide by name with the partial index above, which the index-drift test
  catches.) Search therefore sorts its matches in memory, which is why the page
  is bounded and the term has a minimum length.
*/
ChatMessageSchema.index({ text: 'text' });

export default mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);
