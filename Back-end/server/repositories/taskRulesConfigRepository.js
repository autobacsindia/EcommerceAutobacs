import TaskRulesConfig, { TASK_RULE_DEFAULTS, TASK_RULE_DAYS_MAX } from '../models/TaskRulesConfig.js';

export { TASK_RULE_DEFAULTS, TASK_RULE_DAYS_MAX };

/** The one due-date rules document (models/TaskRulesConfig.js). Data access only. */
const taskRulesConfigRepository = {
  find: () => TaskRulesConfig.findOne({ key: 'default' }).lean(),
  /** Set fields on it, making it first if it does not exist yet. */
  upsert: (set) => TaskRulesConfig.findOneAndUpdate({ key: 'default' }, { $set: set }, { upsert: true, setDefaultsOnInsert: true }),
};

export default taskRulesConfigRepository;
