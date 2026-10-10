import mongoose from 'mongoose';

/**
 * Team chat channel — a "space" (#company, #sales, custom) or a direct message.
 *
 * Internal only: customers never reach any chat route (staffOrAdmin gate), and
 * who may read a channel is decided by `audience`, never by the client:
 *   - 'all'     every admin and active staff member (#company)
 *   - 'team'    admins + active staff of `team` (#sales, #accounts, …)
 *   - 'members' admins + the explicit `members` list (custom spaces)
 * Direct messages are kind 'dm' with audience 'members' and are the one place
 * admins are NOT implicitly present — a DM is only ever its two participants.
 *
 * Team spaces derive membership from the user's `staff.team` at read time, so a
 * new hire sees their team's space the moment their invite is accepted and a
 * deactivated member loses it the moment they are removed — no membership list
 * to keep in sync.
 */
const ChatChannelSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['space', 'dm'], required: true },
    // Stable identity for system spaces ('company', 'team:sales') and DMs
    // ('dm:<idA>:<idB>', ids sorted). Unique, so concurrent get-or-create calls
    // converge on one document. Custom spaces have no key.
    key: { type: String, default: undefined },
    name: { type: String, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 240, default: '' },
    audience: { type: String, enum: ['all', 'team', 'members'], required: true },
    team: { type: String, default: null },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    system: { type: Boolean, default: false }, // created by the app, cannot be archived
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    archived: { type: Boolean, default: false },
    // Per-channel message counter. Messages take their `seq` from an atomic $inc
    // here, which gives gap-free ordering, cheap cursors and unread = last - read.
    lastMessageSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ChatChannelSchema.index(
  { key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } }
);
ChatChannelSchema.index({ members: 1 });
ChatChannelSchema.index({ audience: 1, team: 1 });

export default mongoose.models.ChatChannel || mongoose.model('ChatChannel', ChatChannelSchema);
