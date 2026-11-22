import mongoose from 'mongoose';

/**
 * A job template: a project's shape saved to start the next one from
 * ("Fitting job": Garage 1 · Garage 2 · Operations · Procurement columns,
 * its lists, and the usual tasks with their due dates as days after the start).
 *
 * Saved from a project (services/staffJobTemplateService.js saveJobTemplate)
 * and used by the New project form (createProject with templateId). It holds
 * no people, comments, time, files, job details or money — only the shape.
 * Lists and columns are referred to by their position, since a new project's
 * lists and columns get new ids.
 */
const TemplateTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 120000 }, // a task's notes (formatted)
    priority: { type: String, enum: ['urgent', 'high', 'normal', 'low'], default: 'normal' },
    /** Days after the project's start the task is due (0 = the start day). */
    dueAfterDays: { type: Number, min: 0, max: 365, default: 0 },
    /** Which of the template's lists / columns it goes in (null = none / the first not-started). */
    listIndex: { type: Number, default: null },
    stageIndex: { type: Number, default: null },
    checklist: { type: [String], default: [] },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const StaffJobTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    /** Lower-cased name: one template per name. */
    nameKey: { type: String, required: true, maxlength: 80 },
    colour: { type: String, default: 'blue' },
    description: { type: String, default: '', maxlength: 20000 }, // the project's description
    lists: { type: [new mongoose.Schema({ name: { type: String, required: true } }, { _id: false })], default: [] },
    statuses: {
      type: [new mongoose.Schema({ name: { type: String, required: true }, colour: { type: String, default: 'gray' }, type: { type: String, required: true } }, { _id: false })],
      default: [],
    },
    tasks: { type: [TemplateTaskSchema], default: [] },
    /** The project it was saved from, for "Saved from PRJ-0007" (a note, not a link). */
    fromProject: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true },
);

StaffJobTemplateSchema.index({ nameKey: 1 }, { unique: true, name: 'staff_job_template_name' });

export default mongoose.models.StaffJobTemplate || mongoose.model('StaffJobTemplate', StaffJobTemplateSchema);
