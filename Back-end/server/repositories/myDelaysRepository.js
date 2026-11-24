/**
 * Reads for "My delays" (services/myDelaysService.js). Every read is bounded,
 * projected and `.lean()`, and each one rides an existing index:
 *   tasks    — staff_task_assignees / staff_task_teams / staff_task_all (equality + bucket + rank range)
 *   projects — staff_project_people(owner is a person) / staff_project_teams / staff_project_all (archivedAt + rank range)
 *   people   — _id, and the small set of active heads (role index)
 */
import mongoose from 'mongoose';
import User from '../models/User.js';
import StaffTask from '../models/StaffTask.js';
import StaffProject from '../models/StaffProject.js';

const PERSON_FIELDS = 'name role staff.team staff.isHead staff.active';
const TASK_FIELDS = 'number title dueOn dueTime assignee assigneeName team assignees teams project stageName rev';
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const myDelaysRepository = {
  /** Open, non-personal tasks with a due day before `beforeRank`, at most `limit`. */
  findDueTasks: ({ userId = null, team = null, beforeRank, limit }) => {
    const query = { bucket: 'open', rank: { $lt: beforeRank }, personal: { $ne: true } };
    if (userId) query['assignees.user'] = oid(userId);
    else if (team) query.teams = team;
    return StaffTask.find(query).select(TASK_FIELDS).sort({ rank: 1, _id: 1 }).limit(limit).lean();
  },

  /** Live projects due on or before `uptoRank` and not marked done, at most `limit`. */
  findDueProjects: ({ userId = null, team = null, uptoRank, limit }) => {
    const query = { archivedAt: null, rank: { $lte: uptoRank }, statusOverride: { $ne: 'done' } };
    if (userId) {
      // The owner is always in `people` too: the people index narrows, owner.user decides.
      query['people.user'] = oid(userId);
      query['owner.user'] = oid(userId);
    } else if (team) query.teams = team;
    return StaffProject.find(query).select('number name owner dueOn').sort({ rank: 1, _id: 1 }).limit(limit).lean();
  },

  /** Open tasks per project, for the given projects only. */
  countOpenTasksByProject: (projectIds) => (projectIds.length
    ? StaffTask.aggregate([
      { $match: { project: { $in: projectIds }, bucket: 'open' } },
      { $group: { _id: '$project', n: { $sum: 1 } } },
    ])
    : Promise.resolve([])),

  findPeople: (ids) => (ids.length ? User.find({ _id: { $in: ids } }).select(PERSON_FIELDS).lean() : Promise.resolve([])),

  /** Active team heads (a small set), oldest first so "the" head of a team is stable. */
  findActiveHeads: () => User.find({ role: 'staff', 'staff.isHead': true, 'staff.active': true })
    .select(PERSON_FIELDS).sort({ _id: 1 }).limit(200).lean(),

  findPerson: (id) => User.findById(id).select(PERSON_FIELDS).lean(),
};

export default myDelaysRepository;
