import mongoose from 'mongoose';
import Counter from './Counter.js';

/**
 * A project in the staff Tasks module: one piece of work with an owner, people,
 * dates and a deadline, whose tasks may come from several teams (a Diwali launch
 * with Marketing, Procurement and Developer tasks).
 *
 * A project does not hold tasks: a task names it (StaffTask.project), and stays
 * in its own team's space and list as before. A task belongs to at most one
 * project.
 *
 * Who sees a project — and so may read and comment on every task in it — is
 * the admin, its owner and members (`people`), and the head of any team in
 * `teams` (services/staffProjectService.js). Editing a task still follows the
 * task's own rules.
 *
 * Deleting archives the row (`archivedAt`). Its tasks keep their link, so
 * restoring it brings everything back; while archived it grants nobody access.
 *
 * Every project has a number from the 'staffProject' counter, shown as its code
 * "PRJ-0007" (projectCode below): what people type on an expense to link it, and
 * what the admin searches. Never reused, archived or not. Projects from before
 * numbers got theirs from scripts/backfill-project-numbers.js.
 */
export const PROJECT_COUNTER = 'staffProject';
/** 7 → "PRJ-0007"; 12345 → "PRJ-12345". null for a project not yet numbered. */
export const projectCode = (n) => (Number.isInteger(n) && n > 0 ? `PRJ-${String(n).padStart(4, '0')}` : null);
/** "PRJ-0007", "prj7", "PRJ 7" or "7" → 7; anything else → null. */
export function projectNumberIn(raw) {
  const m = /^\s*(?:prj[\s-]*)?0*(\d{1,9})\s*$/i.exec(String(raw ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
export const PROJECT_STATUSES = Object.freeze(['on_track', 'at_risk', 'late', 'done']);
export const PROJECT_COLOURS = Object.freeze(['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']);

const PersonSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    /** Their team when they were added (null for the admin). */
    team: { type: String, default: null },
  },
  { _id: false },
);

/**
 * The job's own facts (config/projectTemplates.js): which form it uses, the
 * values of that form's fields, extra "label: value" rows, and the order the
 * customer details came from. Validated by services/staffProjectDetailsService.js;
 * stored as plain values (strings, numbers) keyed by field.
 */
const ProjectDetailsSchema = new mongoose.Schema(
  {
    template: { type: String, required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    custom: {
      type: [new mongoose.Schema({ label: { type: String, required: true }, value: { type: String, default: '' } }, { _id: false })],
      default: [],
    },
    /** The order the customer details were filled from (a snapshot, not a live link). */
    order: {
      type: new mongoose.Schema({ id: { type: mongoose.Schema.Types.ObjectId }, number: { type: String } }, { _id: false }),
      default: null,
    },
    updatedAt: { type: Date, default: null },
    updatedByName: { type: String, default: '' },
  },
  { _id: false, minimize: false },
);

/** The kinds a project's own status can be: what it counts as everywhere else. */
export const PROJECT_STAGE_TYPES = Object.freeze(['todo', 'in_progress', 'done']);

/** One list inside a project ("Ads", "Website", "Emails"). Order is the array order. */
const ProjectListSchema = new mongoose.Schema(
  { name: { type: String, required: true, maxlength: 60 } },
  { _id: true },
);

/**
 * One of the project's own statuses ("Review", "Waiting on supplier"). Order is
 * the array order (the board's columns). Empty array: the usual three.
 */
const ProjectStageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 30 },
    colour: { type: String, enum: PROJECT_COLOURS, default: 'gray' },
    type: { type: String, enum: PROJECT_STAGE_TYPES, required: true },
  },
  { _id: true },
);

const StaffProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 2000 },
    colour: { type: String, enum: PROJECT_COLOURS, default: 'blue' },
    owner: { type: PersonSchema, required: true },
    /** Everyone in the project, the owner first. Decides who sees it. */
    people: { type: [PersonSchema], default: [] },
    /** The teams of `people`, each once: their heads see the project too. */
    teams: { type: [String], default: [] },
    startOn: { type: String, default: null },
    dueOn: { type: String, default: null },
    /** The list order: the deadline, 'YYYY-MM-DD', or '9999-12-31' for none. */
    rank: { type: String, required: true },
    /** Its lists, at most PROJECT_LISTS_MAX (services/staffProjectService.js). */
    lists: { type: [ProjectListSchema], default: [] },
    /** Its own statuses, at most PROJECT_STAGES_MAX; none means To do / In progress / Done. */
    statuses: { type: [ProjectStageSchema], default: [] },
    /** Where an imported project came from ("clickup:folder:<id>"), so a re-run finds it again. */
    importKey: { type: String, default: undefined, maxlength: 100 },
    /** Set by the owner to say how it stands; null lets the tasks decide. */
    statusOverride: { type: String, enum: [...PROJECT_STATUSES, null], default: null },
    /**
     * Each slip's own boxes (models/SlipTemplate.js `fields`), by slip key:
     * { values, updatedAt, updatedByName }. Kept so the next print of the same
     * slip is one click.
     */
    slipValues: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** The job's details and template; null until someone fills them in. */
    details: { type: ProjectDetailsSchema, default: null },
    rev: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    /** The browser's id for this create, so a double-clicked "Create" makes one project. */
    clientId: { type: String, default: undefined, maxlength: 64 },
    /** PRJ-<number>: set once when created (the pre-save hook below), never changed. */
    number: { type: Number, default: undefined, immutable: true },
  },
  { timestamps: true, collection: 'staffprojects' },
);

/*
  Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off
  in production), under the same names. Each list is equality + (rank, _id), so
  a keyset page is one index range per branch of the visibility $or.
*/
StaffProjectSchema.index({ archivedAt: 1, rank: 1, _id: 1 }, { name: 'staff_project_all' });
StaffProjectSchema.index({ 'people.user': 1, archivedAt: 1, rank: 1, _id: 1 }, { name: 'staff_project_people' });
StaffProjectSchema.index({ teams: 1, archivedAt: 1, rank: 1, _id: 1 }, { name: 'staff_project_teams' });
// One project per number. Partial: projects from before numbers have none until backfilled.
StaffProjectSchema.index(
  { number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'number' } }, name: 'staff_project_number' },
);

/*
  Every new project is numbered here — the panel's create, the ClickUp importer,
  a test fixture — so no path can make one without a code. The counter is one
  atomic $inc: two projects created at the same moment get different numbers. A
  create that then fails (validation) leaves a gap, never a duplicate.
*/
StaffProjectSchema.pre('save', async function numberNewProject() {
  if (this.isNew && this.number == null) this.number = await Counter.next(PROJECT_COUNTER);
});
// `$type`, never `$ne` — MongoDB rejects `$ne` in a partialFilterExpression.
StaffProjectSchema.index(
  { createdBy: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_project_client_id' },
);

StaffProjectSchema.index(
  { importKey: 1 },
  { unique: true, partialFilterExpression: { importKey: { $type: 'string' } }, name: 'staff_project_import_key' },
);

export default mongoose.models.StaffProject || mongoose.model('StaffProject', StaffProjectSchema);
