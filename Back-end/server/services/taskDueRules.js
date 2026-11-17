/**
 * Due-date rules for staff tasks (asked for by the team, 2026-11):
 *
 *   1. Every new task has a due date, and a date once set can't be taken off.
 *   2. A due date more than `approvalAfterDays` (9) days away waits for a
 *      manager's approval. Who that is lives in services/staffTaskService.js.
 *   3. Each priority has a latest allowed due date (`maxDays`): High must be
 *      due today or tomorrow, and so on. A hard limit — an approval can't go
 *      past it; lower the priority instead.
 *
 * "Days away" is counted in IST calendar days from today, like the rest of the
 * Tasks module ("due today" means the same day for everyone). The rules run when
 * someone sets a date or a priority — never over tasks already saved, so an
 * older task with no date, or a far one, stays as it is until it is changed.
 *
 * The functions here are pure apart from reading and writing the admin's
 * numbers (models/TaskRulesConfig.js), so every boundary is tested directly.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import taskRulesConfigRepository, { TASK_RULE_DEFAULTS, TASK_RULE_DAYS_MAX } from '../repositories/taskRulesConfigRepository.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_PRIORITIES = Object.keys(TASK_RULE_DEFAULTS.maxDays);
const LABEL = Object.freeze({ urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' });

const utcOf = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole IST calendar days from `today` to `dueOn` (both 'YYYY-MM-DD'); negative when already past. */
export const daysAhead = (dueOn, today) => Math.round((utcOf(dueOn) - utcOf(today)) / DAY_MS);

/** The calendar day `n` days after `ymd`. */
export const addDays = (ymd, n) => new Date(utcOf(ymd) + n * DAY_MS).toISOString().slice(0, 10);

/** "due today", "due today or tomorrow", "due within 30 days". */
export function limitText(max) {
  if (max === 0) return 'due today';
  if (max === 1) return 'due today or tomorrow';
  return `due within ${max} days`;
}

/** The rules with every field present, whatever is (or isn't) stored. */
export function normaliseRules(raw) {
  const pick = (v, def) => (Number.isInteger(v) && v >= 0 && v <= TASK_RULE_DAYS_MAX ? v : def);
  return {
    approvalAfterDays: pick(raw?.approvalAfterDays, TASK_RULE_DEFAULTS.approvalAfterDays),
    maxDays: Object.fromEntries(TASK_PRIORITIES.map((p) => [p, pick(raw?.maxDays?.[p], TASK_RULE_DEFAULTS.maxDays[p])])),
  };
}

/**
 * Check a due date against a priority. Throws 400 when the date is later than
 * the priority allows; otherwise says whether it needs a manager's approval.
 *
 * @param {{ dueOn: string, priority: string, today: string, rules: object }} input
 * @returns {{ days: number, needsApproval: boolean }}
 */
export function checkDue({ dueOn, priority, today, rules }) {
  const days = daysAhead(dueOn, today);
  const max = rules.maxDays[priority];
  if (days > max) {
    throw fail(`A ${LABEL[priority]} priority task must be ${limitText(max)} (by ${addDays(today, max)}). Pick an earlier date or a lower priority.`, 400);
  }
  return { days, needsApproval: days > rules.approvalAfterDays };
}

/** The admin's current rules (defaults until they change one). */
export async function getTaskRules() {
  return normaliseRules(await taskRulesConfigRepository.find());
}

/** The rules as the panel shows them: the numbers and who last changed them. */
export async function readTaskRules() {
  const doc = await taskRulesConfigRepository.find();
  return { ...normaliseRules(doc), updatedAt: doc?.updatedAt ?? null, updatedByName: doc?.updatedByName ?? '' };
}

function cleanDays(raw, what) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (!Number.isInteger(n) || n < 0 || n > TASK_RULE_DAYS_MAX) {
    throw fail(`${what} must be a whole number of days from 0 to ${TASK_RULE_DAYS_MAX}.`, 400);
  }
  return n;
}

/**
 * Change the rules (admin only). Only the numbers sent change. Affects the next
 * date or priority someone sets; tasks already saved are left as they are.
 */
export async function updateTaskRules(actor, input = {}, req) {
  if (actor?.role !== 'admin') throw fail('Only the admin can change the task date rules.', 403);
  const set = {};
  if (input.approvalAfterDays !== undefined) set.approvalAfterDays = cleanDays(input.approvalAfterDays, 'Approval needed after');
  if (input.maxDays !== undefined) {
    if (!input.maxDays || typeof input.maxDays !== 'object') throw fail('Pick the limits for each priority.', 400);
    for (const p of TASK_PRIORITIES) {
      if (input.maxDays[p] !== undefined) set[`maxDays.${p}`] = cleanDays(input.maxDays[p], `The ${LABEL[p]} limit`);
    }
  }
  if (!Object.keys(set).length) throw fail('Nothing to change.', 400);
  const before = await getTaskRules();
  await taskRulesConfigRepository.upsert({ ...set, updatedBy: actor._id, updatedByName: actor.name || '' });
  const after = await readTaskRules();
  auditLogger.logAction(req, 'UPDATE', 'TaskRulesConfig', 'default', { before, after: normaliseRules(after) });
  return after;
}
