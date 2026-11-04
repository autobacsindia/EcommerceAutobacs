import mongoose from 'mongoose';

/**
 * A folder or a list inside a team's task space (ClickUp-style):
 *
 *   Procurement            ← the team (a space; STAFF_TEAMS)
 *     Suppliers            ← kind 'folder'
 *       Bosch orders       ← kind 'list', folder = Suppliers
 *     Weekly stock check   ← kind 'list', folder = null (straight in the space)
 *
 * A task sits in at most one list (StaffTask.list). Lists only organise work:
 * who may see a task is still decided by its people and teams
 * (services/staffTaskService.js canSee), never by the list it is in.
 *
 * Deleting archives the row (`archivedAt`) and frees its name; the tasks in it
 * go back to the space's "Other tasks". Nothing is ever erased.
 */
export const TASK_LIST_KINDS = Object.freeze(['folder', 'list']);
export const TASK_LIST_COLOURS = Object.freeze(['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']);

const StaffTaskListSchema = new mongoose.Schema(
  {
    team: { type: String, required: true },
    kind: { type: String, enum: TASK_LIST_KINDS, required: true },
    /** The folder a list is in; null for a folder, or a list straight in the space. */
    folder: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, required: true, maxlength: 60 },
    /**
     * The name folded for the uniqueness check (one "Bosch orders" per folder).
     * A deleted row gets `#<its id>` appended, so its name can be used again.
     */
    nameKey: { type: String, required: true },
    colour: { type: String, enum: TASK_LIST_COLOURS, default: 'gray' },
    order: { type: Number, default: 0 },
    rev: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/*
  Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off
  in production), under the same names.
*/
// A space's whole tree is one range (a space holds at most LISTS_MAX rows).
StaffTaskListSchema.index({ team: 1, archivedAt: 1, order: 1 }, { name: 'staff_task_list_team' });
// One name per kind per place; what makes a double-clicked "Create" land once.
StaffTaskListSchema.index({ team: 1, folder: 1, kind: 1, nameKey: 1 }, { unique: true, name: 'staff_task_list_name' });

export default mongoose.models.StaffTaskList || mongoose.model('StaffTaskList', StaffTaskListSchema);
