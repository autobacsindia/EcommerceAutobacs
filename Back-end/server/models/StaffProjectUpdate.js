import mongoose from 'mongoose';
import { FileSchema } from './StaffTask.js';

/**
 * One update on a staff project (models/StaffProject.js): words, photos and
 * videos — "Bumper fitted, see the video". The project's running record, newest
 * first. Its own collection, so a long-running job never grows the project
 * document every list reads, and updates page with a keyset cursor.
 *
 * Who may read them is the project's own visibility
 * (services/staffProjectService.js). Files live in the private bucket under
 * `projects/<projectId>/` and are read back only through the access-checked
 * route (services/staffProjectUpdateService.js).
 *
 * Deleting is soft for the words (kept for the record, never sent to a
 * browser) and HARD for the files: a photo someone removed is gone from
 * storage, not just hidden.
 */
const StaffProjectUpdateSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffProject', required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    /** Formatted text (utils/richText.js); empty only when the update is files alone. */
    text: { type: String, default: '', maxlength: 120000 }, // words ≤ STAFF_LONG_TEXT_MAX (20,000); markup up to 6×
    attachments: { type: [FileSchema], default: undefined },
    /** The browser's id for this post, so a double-tapped "Post" saves once. */
    clientId: { type: String, default: undefined, maxlength: 64 },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'staffprojectupdates' },
);

// Also built at startup by config/db.js ensureCriticalIndexes, same names.
StaffProjectUpdateSchema.index({ project: 1, _id: -1 }, { name: 'staff_project_update_project' });
StaffProjectUpdateSchema.index(
  { by: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_project_update_client_id' },
);

export default mongoose.models.StaffProjectUpdate || mongoose.model('StaffProjectUpdate', StaffProjectUpdateSchema);
