import mongoose from 'mongoose';

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
 */
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
    /** Set by the owner to say how it stands; null lets the tasks decide. */
    statusOverride: { type: String, enum: [...PROJECT_STATUSES, null], default: null },
    rev: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    /** The browser's id for this create, so a double-clicked "Create" makes one project. */
    clientId: { type: String, default: undefined, maxlength: 64 },
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
// `$type`, never `$ne` — MongoDB rejects `$ne` in a partialFilterExpression.
StaffProjectSchema.index(
  { createdBy: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } }, name: 'staff_project_client_id' },
);

export default mongoose.models.StaffProject || mongoose.model('StaffProject', StaffProjectSchema);
