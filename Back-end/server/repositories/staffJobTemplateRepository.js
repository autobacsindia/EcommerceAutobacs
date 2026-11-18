import StaffJobTemplate from '../models/StaffJobTemplate.js';
import StaffTask from '../models/StaffTask.js';

/**
 * Job templates (models/StaffJobTemplate.js) and the one read of a project's
 * tasks that saving one needs. Data access only — the rules live in
 * services/staffJobTemplateService.js.
 */
const staffJobTemplateRepository = {
  model: StaffJobTemplate,

  create: async (doc) => (await StaffJobTemplate.create(doc)).toObject(),
  findById: (id) => StaffJobTemplate.findById(id).lean(),
  /** Every template, by name — at most `cap` (the service caps how many can exist). */
  list: (cap) => StaffJobTemplate.find({}).sort({ nameKey: 1 }).limit(cap).lean(),
  /** Names and counts only, for the New project picker. */
  listSummaries: (cap) => StaffJobTemplate.find({})
    .select({ name: 1, colour: 1, statuses: 1, lists: 1, 'tasks.title': 1, createdBy: 1, createdByName: 1, fromProject: 1 })
    .sort({ nameKey: 1 }).limit(cap).lean(),
  count: () => StaffJobTemplate.countDocuments({}),
  deleteById: (id) => StaffJobTemplate.deleteOne({ _id: id }),

  /**
   * A project's top-level tasks that are not archived (open and done), soonest
   * due first — at most `cap`. One range of staff_task_project per bucket.
   */
  projectTasks: (project, cap) => StaffTask.find({ project, bucket: { $in: ['open', 'done'] }, parent: null })
    .select({ title: 1, description: 1, priority: 1, dueOn: 1, projectList: 1, stage: 1, checklist: 1, tags: 1, createdAt: 1 })
    .sort({ dueOn: 1, _id: 1 })
    .limit(cap)
    .lean(),
};

export default staffJobTemplateRepository;
