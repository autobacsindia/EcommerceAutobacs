import mongoose from 'mongoose';

/**
 * A thread someone is in — they started it or replied in it — for the
 * "Threads" list in team chat. One row per person per thread.
 *
 *   readSeq        — the newest reply they have seen (a channel seq: replies
 *                    take channel seqs, models/ChatMessage.js). Replies past it
 *                    are their unread. Moves only forward ($max).
 *   lastActivityAt — when the thread last got a reply, copied here on every
 *                    reply so the list can be read newest-first from this
 *                    collection alone, without joining every root.
 *   channel        — so the list drops threads from conversations the person
 *                    can no longer read, without loading each root first.
 *
 * Written by chatService on reply (the replier, the root's author, and a
 * lastActivityAt bump for everyone else in the thread) and when a thread is
 * opened (readSeq). Private: nobody sees who else follows a thread.
 */
const ChatThreadFollowSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    root: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    readSeq: { type: Number, default: 0 },
    lastActivityAt: { type: Date, required: true },
  },
  { timestamps: false }
);

// One row per person per thread — a retried reply is still one row. Root
// first, so "everyone in this thread" (the bump on every reply) uses it too.
ChatThreadFollowSchema.index({ root: 1, user: 1 }, { unique: true });
// The Threads list: my threads, newest activity first, keyset on (lastActivityAt, _id).
ChatThreadFollowSchema.index({ user: 1, lastActivityAt: -1, _id: -1 }, { name: 'chat_thread_follows_list' });

export default mongoose.models.ChatThreadFollow || mongoose.model('ChatThreadFollow', ChatThreadFollowSchema);
