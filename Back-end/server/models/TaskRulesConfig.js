import mongoose from 'mongoose';

/**
 * TaskRulesConfig — the admin's due-date rules for staff tasks. One document
 * (key: "default"), read through services/taskDueRules.js getTaskRules().
 *
 *   approvalAfterDays   a due date more than this many days away waits for a
 *                       manager's approval (default 9: day 9 is fine, day 10 waits)
 *   maxDays.<priority>  the latest a task of that priority may be due, in days
 *                       from today (IST). A hard limit: approval cannot go past it.
 *                       0 = today only, 1 = today or tomorrow.
 *
 * Changing these affects the next date or priority someone sets, never tasks
 * already saved (services/taskDueRules.js says why).
 */
export const TASK_RULE_DEFAULTS = Object.freeze({
  approvalAfterDays: 9,
  maxDays: Object.freeze({ urgent: 0, high: 1, normal: 30, low: 60 }),
});
/** The largest number of days any limit may be set to (about a year). */
export const TASK_RULE_DAYS_MAX = 365;

const days = (def) => ({ type: Number, default: def, min: 0, max: TASK_RULE_DAYS_MAX });

const TaskRulesConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true, immutable: true },
    approvalAfterDays: days(TASK_RULE_DEFAULTS.approvalAfterDays),
    maxDays: {
      urgent: days(TASK_RULE_DEFAULTS.maxDays.urgent),
      high: days(TASK_RULE_DEFAULTS.maxDays.high),
      normal: days(TASK_RULE_DEFAULTS.maxDays.normal),
      low: days(TASK_RULE_DEFAULTS.maxDays.low),
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true, collection: 'taskrulesconfig' },
);

export default mongoose.models.TaskRulesConfig || mongoose.model('TaskRulesConfig', TaskRulesConfigSchema);
