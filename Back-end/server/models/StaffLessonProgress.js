import mongoose from 'mongoose';

/** "This person finished this lesson." One row per person per lesson. */
const StaffLessonProgressSchema = new mongoose.Schema(
  {
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffLesson', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, required: true },
  },
  { collection: 'stafflessonprogress' },
);

/*
  Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off
  in production), under the same name. Unique so a double click records once.
*/
StaffLessonProgressSchema.index({ lesson: 1, user: 1 }, { unique: true, name: 'staff_lesson_progress_person' });

export default mongoose.models.StaffLessonProgress || mongoose.model('StaffLessonProgress', StaffLessonProgressSchema);
