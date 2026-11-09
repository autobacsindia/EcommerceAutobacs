import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';

/**
 * One lesson in the staff Lesson Library: written notes plus PDFs, videos,
 * PowerPoints and other files. Who may see and change it lives in
 * services/staffLessonService.js.
 *
 *   audience       'company' (everyone in the panel) or one team's key.
 *   topic          optional free label for the job it is about ("GTM lead").
 *   owner          the person who keeps it true; `lastCheckedAt` is when someone
 *                  last confirmed it still is, and goes stale after 90 days.
 *   rev            bumped on every text edit; an edit names the rev it was made
 *                  against, so two people editing cannot silently overwrite each
 *                  other. Adding a file does not bump it: a file changes no text.
 *   archivedAt     "delete" archives, like tasks. Files stay in storage.
 */
export const LESSON_AUDIENCES = Object.freeze(['company', ...STAFF_TEAM_VALUES]);
export const LESSON_FILE_KINDS = Object.freeze(['video', 'pdf', 'slides', 'document', 'image']);

const LessonFileSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    provider: { type: String, default: 'r2' },
    kind: { type: String, enum: LESSON_FILE_KINDS, required: true },
    name: { type: String, required: true, maxlength: 100 },
    mime: { type: String, required: true },
    size: { type: Number, default: 0 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    at: { type: Date, default: null },
  },
  { _id: false },
);

const StaffLessonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, default: '' },
    audience: { type: String, enum: LESSON_AUDIENCES, required: true },
    topic: { type: String, trim: true, maxlength: 60, default: '' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    lastCheckedAt: { type: Date, required: true },
    lastCheckedByName: { type: String, default: '' },
    files: { type: [LessonFileSchema], default: [] },
    rev: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/*
  Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off
  in production), under the same names. Keyed on _id for the newest-first keyset page.
*/
StaffLessonSchema.index({ archivedAt: 1, audience: 1, _id: -1 }, { name: 'staff_lesson_audience' });
StaffLessonSchema.index({ archivedAt: 1, _id: -1 }, { name: 'staff_lesson_all' });

// Whose lessons: measured in tests/staffHandoverIndexUsage.test.js; also in ensureCriticalIndexes.
StaffLessonSchema.index({ owner: 1, archivedAt: 1, _id: 1 }, { name: 'staff_lesson_owner' });

export default mongoose.models.StaffLesson || mongoose.model('StaffLesson', StaffLessonSchema);
