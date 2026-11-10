import mongoose from 'mongoose';

/**
 * A note about someone who left a team, written by that team's head or an
 * admin, for whoever joins the team next (services/staffPastMemberNoteService.js).
 * `team` is the member's team when the note was written; reads are decided from
 * the member, so it is kept for the record only.
 */
const StaffPastMemberNoteSchema = new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: String, required: true },
  body: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, default: '' },
  editedAt: { type: Date, default: null },
  // Bumped on every edit, so two edits at once cannot silently overwrite each other.
  rev: { type: Number, default: 0 },
}, { timestamps: true, collection: 'staffpastmembernotes' });

// One person's notes, newest first (keyset on _id). Also built by
// config/db.js ensureCriticalIndexes under the same name.
StaffPastMemberNoteSchema.index({ member: 1, _id: -1 }, { name: 'staff_past_note_member' });

export default mongoose.models.StaffPastMemberNote || mongoose.model('StaffPastMemberNote', StaffPastMemberNoteSchema);
