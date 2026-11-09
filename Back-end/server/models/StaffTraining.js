import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';

/**
 * Training for a job: an ordered set of lessons, a test at the end, and the
 * head's sign-off. Who may do what is services/staffTrainingService.js.
 *
 *   StaffTrainingPath        what the head sets up once per job. Holds the answer
 *                            key, so only people who manage the team may read it.
 *   StaffTrainingAssignment  one person on one path. Its lessons are copied here,
 *                            so editing the path later does not change their plan.
 *   StaffTrainingAttempt     one sitting of the test. Its questions are copied
 *                            here, so editing the test never changes a past score.
 *
 * `status` on an assignment is recomputed from its attempts (syncAssignment), so a
 * crash between saving an attempt and updating the assignment heals on the retry.
 */
export const TRAINING_STAGES = Object.freeze(['day1', 'week1', 'month1']);
export const TRAINING_STATUSES = Object.freeze(['learning', 'marking', 'ready_for_signoff', 'needs_help', 'signed_off', 'cancelled']);
export const TRAINING_WAITING = Object.freeze(['marking', 'ready_for_signoff', 'needs_help']);

const QuestionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['choice', 'written'], required: true },
    text: { type: String, required: true, maxlength: 500 },
    options: { type: [String], default: [] },
    correct: { type: Number, default: null },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffLesson', default: null },
    lessonTitle: { type: String, default: '' },
  },
  { _id: true },
);

const ItemSchema = new mongoose.Schema(
  {
    stage: { type: String, enum: TRAINING_STAGES, required: true },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffLesson', required: true },
    title: { type: String, default: '' },
  },
  { _id: false },
);

const PathSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    team: { type: String, enum: STAFF_TEAM_VALUES, required: true },
    items: { type: [ItemSchema], default: [] },
    questions: { type: [QuestionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    rev: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PathSchema.index({ archivedAt: 1, team: 1, _id: -1 }, { name: 'staff_training_path_team' });

const AssignmentSchema = new mongoose.Schema(
  {
    path: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTrainingPath', required: true },
    pathTitle: { type: String, required: true },
    team: { type: String, enum: STAFF_TEAM_VALUES, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    buddy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    buddyName: { type: String, default: '' },
    items: { type: [ItemSchema], default: [] },
    status: { type: String, enum: TRAINING_STATUSES, default: 'learning' },
    active: { type: Boolean, default: true },
    attemptsAllowed: { type: Number, default: 3 },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedByName: { type: String, default: '' },
    signedOffBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    signedOffByName: { type: String, default: '' },
    signedOffAt: { type: Date, default: null },
  },
  { timestamps: true },
);
/*
  Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off in
  production), under the same names. One live assignment per person per path, so a
  double-clicked "Assign" lands once. `active` rather than a status list: a partial
  filter must stay an equality to be built everywhere.
*/
AssignmentSchema.index({ path: 1, user: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'staff_training_one_live' });
// Each one measured in tests/staffTrainingIndexUsage.test.js; also in ensureCriticalIndexes.
AssignmentSchema.index({ user: 1, _id: -1 }, { name: 'staff_training_mine' });
AssignmentSchema.index({ buddy: 1, _id: -1 }, { name: 'staff_training_buddy' });
AssignmentSchema.index({ team: 1, _id: -1 }, { name: 'staff_training_team' });
AssignmentSchema.index({ active: 1, status: 1, team: 1 }, { name: 'staff_training_waiting' });

const AttemptQuestionSchema = new mongoose.Schema(
  {
    qid: { type: String, required: true },
    type: { type: String, enum: ['choice', 'written'], required: true },
    text: { type: String, required: true },
    options: { type: [String], default: [] },
    correct: { type: Number, default: null },
    lessonTitle: { type: String, default: '' },
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
    right: { type: Boolean, default: null },
  },
  { _id: false },
);

const AttemptSchema = new mongoose.Schema(
  {
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffTrainingAssignment', required: true },
    number: { type: Number, required: true },
    status: { type: String, enum: ['open', 'marking', 'graded'], default: 'open' },
    questions: { type: [AttemptQuestionSchema], default: [] },
    score: { type: Number, default: null },
    passed: { type: Boolean, default: null },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    markedByName: { type: String, default: '' },
  },
  { collection: 'stafftrainingattempts' },
);
// The unique number is what makes two "Start" presses one attempt.
AttemptSchema.index({ assignment: 1, number: 1 }, { unique: true, name: 'staff_training_attempt_number' });

export const StaffTrainingPath = mongoose.models.StaffTrainingPath || mongoose.model('StaffTrainingPath', PathSchema);
export const StaffTrainingAssignment = mongoose.models.StaffTrainingAssignment || mongoose.model('StaffTrainingAssignment', AssignmentSchema);
export const StaffTrainingAttempt = mongoose.models.StaffTrainingAttempt || mongoose.model('StaffTrainingAttempt', AttemptSchema);
