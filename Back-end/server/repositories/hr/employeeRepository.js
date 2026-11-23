/**
 * Employee profiles (models/hr/EmployeeProfile.js). Data access only — rules and
 * validation live in services/hr/employeeService.js. Encrypted fields are never
 * selected here unless a function says so in its name.
 */
import EmployeeProfile from '../../models/hr/EmployeeProfile.js';

const employeeRepository = {
  findById: (id) => EmployeeProfile.findById(id).lean(),
  findByUser: (userId) => EmployeeProfile.findOne({ user: userId }).lean(),
  list: (query, { select, sort, limit }) => EmployeeProfile.find(query).select(select).sort(sort).limit(limit).lean(),
  create: (doc) => EmployeeProfile.create(doc),
  /** CAS update: matches only when `rev` is unchanged; returns the new doc or null. */
  updateIfRev: (id, rev, set, actorId) => EmployeeProfile.findOneAndUpdate(
    { _id: id, rev },
    { $set: { ...set, updatedBy: actorId }, $inc: { rev: 1 } },
    { new: true, runValidators: true },
  ).lean(),
  setOnboardingItem: (id, key, done, actorId, at) => EmployeeProfile.findOneAndUpdate(
    { _id: id, 'onboarding.key': key, status: { $ne: 'exited' } },
    {
      $set: {
        'onboarding.$.done': done,
        'onboarding.$.doneAt': done ? at : null,
        'onboarding.$.doneBy': done ? actorId : null,
        updatedBy: actorId,
      },
      $inc: { rev: 1 },
    },
    { new: true },
  ).lean(),
};

export default employeeRepository;
