import mongoose from 'mongoose';

/**
 * One attachment on a message. Stored in Cloudinary; we keep only the delivery
 * URL plus the public id needed to delete it later.
 */
const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    // 'r2' (private bucket, served by /chat/channels/:id/files/:name) or 'cloudinary' (older files).
    provider: { type: String, default: 'cloudinary' },
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
 * `deletedAt`; the row and its text stay, admins can still read them, and the
 * API withholds them from everyone else.
 */
/**
 * A quoted message ("replying to …"). Snapshotted at send time, like an order's
 * prices: the quote shows what the person was answering even if that message is
 * later hidden. Always a message from the SAME channel (chatService enforces it),
 * so a quote can never carry text into a conversation that could not read it.
 */
const QuoteSchema = new mongoose.Schema(
  {
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    seq: { type: Number, required: true },
    by: { type: String, default: '' },
    preview: { type: String, default: '' },
    /*
      Set when the quoted message is later deleted by its author. The preview
      is a snapshot, so without this flag the deleted words would live on in
      every reply that quoted them. Readers other than admins get the preview
      withheld; admins (who see every message) still read it.
    */
    deleted: { type: Boolean, default: undefined },
  },
  { _id: false }
);

/**
 * One earlier version of an edited message. Admins read these; nobody else does —
 * an edit exists to correct a message, and showing everyone the mistake would
 * defeat that. Kept for the same reason deletes are soft: chat is part of the
 * company record.
 */
const EditSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    editedAt: { type: Date, required: true },
  },
  { _id: false }
);

/**
 * One emoji on a message and who put it there. A person appears at most once per
 * emoji; an emoji with nobody left is removed (chatRepository.setReaction does
 * both in one atomic write, so two people reacting at once never lose a tap).
 */
const ReactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true, maxlength: 32 },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

/**
 * Where a forwarded message came from: who wrote it and when — a snapshot, like
 * a quote. The source message id is kept for the record but never sent to
 * clients: the people reading the forward may not be able to read the original
 * conversation, and must not learn which one it was.
 */
const ForwardSchema = new mongoose.Schema(
  {
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    by: { type: String, default: '' },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    seq: { type: Number, required: true },
    kind: { type: String, enum: ['user', 'system'], default: 'user' },
    /*
      Which tab of a space shows it: 'updates' = the "Order updates" tab (every
      automatic post, and a person's reply inside an order's update thread);
      unset = Chat. Each tab has its own unread count and read position
      (ChatReadState). Messages older than this field have it unset; for them
      kind 'system' alone means updates.
    */
    lane: { type: String, enum: ['updates'], default: undefined },
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
    /**
     * "@all": everyone who can read the conversation. In #company only admins
     * and team heads may use it (chatService) — one person must not be able to
     * ping the whole company. Unset when not used.
     */
    mentionAll: { type: Boolean, default: undefined },
    refs: { type: [RefSchema], default: [] },
    quote: { type: QuoteSchema, default: undefined },
    forwardedFrom: { type: ForwardSchema, default: undefined },
    /*
      Pinned to the top of its conversation ("Pinned" strip), by anyone who can
      read it. `pinnedByName` is a snapshot, like a quote's author. Unset when
      not pinned. At most MAX_PINS_PER_CHANNEL per conversation (chatService).
    */
    pinnedAt: { type: Date, default: undefined },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    pinnedByName: { type: String, default: undefined, maxlength: 80 },
    // Emoji reactions, in the order each emoji was first used. Capped per
    // message (chatService.MAX_REACTIONS_PER_MESSAGE). Unset until the first one.
    reactions: { type: [ReactionSchema], default: undefined },

    /*
      Threads. A reply carries `threadRoot`; a top-level message does not.

      The channel timeline shows top-level messages only, ordered by
      `activitySeq` — the seq of the newest thing in the thread (its own seq
      until someone replies). A reply takes a channel seq like any message, so
      unread counts and ordering stay one number per channel, and then bumps
      its root's activitySeq: a thread that moves comes back to the bottom of
      the conversation instead of changing silently, days up the scroll.

      The root also carries a summary of its newest reply, so the timeline can
      show "3 replies · ⏳ Ravi will wait…" without loading the thread.
    */
    threadRoot: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    activitySeq: { type: Number },
    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date, default: null },
    lastReplyPreview: { type: String, default: '', maxlength: 200 },
    lastReplyBy: { type: String, default: '', maxlength: 80 },
    lastReplyMentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    /*
      Set on the system post that starts an order's thread in a space. Every
      later automatic update about that order in that space is a reply to it,
      so one order reads as one conversation. Unique per channel (below), which
      also settles two first updates racing to start the thread.
    */
    threadOrder: { type: mongoose.Schema.Types.ObjectId, default: undefined },

    /*
      Edit and delete: the author only, within CHAT_EDIT_WINDOW_MS of sending
      (chatService). Both are SOFT — the row and its earlier text stay, and an
      admin sees them; everyone else sees "edited" or "This message was deleted".
      `editHistory` holds the versions BEFORE each edit, oldest first, capped so
      a message edited in a loop cannot grow without bound.
    */
    editedAt: { type: Date, default: null },
    editHistory: { type: [EditSchema], default: undefined },

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
// The channel timeline: top-level messages by latest activity. `threadRoot`
// is null on every top-level message (default), so equality on it is exact.
ChatMessageSchema.index({ channel: 1, threadRoot: 1, activitySeq: -1 }, { name: 'chat_timeline' });
// A thread's replies in order. Partial: only replies carry a root.
ChatMessageSchema.index(
  { threadRoot: 1, seq: 1 },
  { name: 'chat_thread_replies', partialFilterExpression: { threadRoot: { $type: 'objectId' } } }
);
// One order thread per channel.
ChatMessageSchema.index(
  { channel: 1, threadOrder: 1 },
  { name: 'chat_order_thread', unique: true, partialFilterExpression: { threadOrder: { $type: 'objectId' } } }
);
// A conversation's pinned messages, newest pin first. Partial: only pinned rows.
ChatMessageSchema.index(
  { channel: 1, pinnedAt: -1 },
  { name: 'chat_pins', partialFilterExpression: { pinnedAt: { $type: 'date' } } }
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
