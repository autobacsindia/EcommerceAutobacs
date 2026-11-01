/**
 * The list view's groups, made from the rows already loaded (the server pages
 * in the chosen order; grouping never reorders inside a group, so "newest
 * first" stays newest first within "High").
 *
 * A group's `addStatus` is where "+ Add task" in it starts a task — only status
 * groups have one; `key` is stable so folding a group survives a reload.
 */
import { formatDueDay, todayIST, type Task, type TaskGroupBy, type TaskPriority, type TaskStatus } from './types';

export type TaskGroup = {
  key: string;
  label: string;
  /** What the header shows beside the label: a status, a priority, a person or a due bucket. */
  kind: 'status' | 'priority' | 'person' | 'due' | 'all';
  value: string;
  tasks: Task[];
  addStatus?: Exclude<TaskStatus, 'done'>;
};

/** Active work first, waiting next, not started last. Done is its own, folded list. */
export const STATUS_ORDER: Exclude<TaskStatus, 'done'>[] = ['in_progress', 'waiting', 'todo'];
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];
const PRIORITY_LABEL: Record<TaskPriority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

/** The IST day `n` days after `ymd`. */
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Which due bucket an open task falls in. */
export function dueBucket(t: Pick<Task, 'dueOn'>, today: string): { value: string; label: string } {
  if (!t.dueOn) return { value: 'none', label: 'No due date' };
  if (t.dueOn < today) return { value: 'late', label: 'Late' };
  if (t.dueOn === today) return { value: 'today', label: 'Today' };
  if (t.dueOn === addDays(today, 1)) return { value: 'tomorrow', label: 'Tomorrow' };
  if (t.dueOn <= addDays(today, 6)) return { value: 'week', label: 'Next 7 days' };
  return { value: 'later', label: `Later (from ${formatDueDay(addDays(today, 7))})` };
}
const DUE_ORDER = ['late', 'today', 'tomorrow', 'week', 'later', 'none'];

/**
 * Open tasks into groups, in a fixed order. Status groups are always all three
 * (empty ones too, for their "+ Add task") unless `hideEmpty`; the others only
 * exist when they have rows.
 */
export function groupTasks(tasks: Task[], by: TaskGroupBy, { today = todayIST(), hideEmpty = false } = {}): TaskGroup[] {
  if (by === 'none') return [{ key: 'all', label: 'All tasks', kind: 'all', value: 'all', tasks }];
  if (by === 'status') {
    return STATUS_ORDER
      .map((s) => ({ key: `status:${s}`, label: STATUS_LABEL[s], kind: 'status' as const, value: s, addStatus: s, tasks: tasks.filter((t) => t.status === s) }))
      .filter((g) => !hideEmpty || g.tasks.length);
  }
  if (by === 'priority') {
    return PRIORITY_ORDER
      .map((p) => ({ key: `priority:${p}`, label: PRIORITY_LABEL[p], kind: 'priority' as const, value: p, tasks: tasks.filter((t) => t.priority === p) }))
      .filter((g) => g.tasks.length);
  }
  if (by === 'due') {
    const buckets = new Map<string, TaskGroup>();
    for (const t of tasks) {
      const b = dueBucket(t, today);
      if (!buckets.has(b.value)) buckets.set(b.value, { key: `due:${b.value}`, label: b.label, kind: 'due', value: b.value, tasks: [] });
      buckets.get(b.value)!.tasks.push(t);
    }
    return DUE_ORDER.filter((v) => buckets.has(v)).map((v) => buckets.get(v)!);
  }
  // By person: in order of first appearance would shuffle as pages load, so by name.
  const people = new Map<string, TaskGroup>();
  for (const t of tasks) {
    const id = t.assignee.id;
    if (!people.has(id)) people.set(id, { key: `person:${id}`, label: t.assignee.name || 'Someone', kind: 'person', value: id, tasks: [] });
    people.get(id)!.tasks.push(t);
  }
  return [...people.values()].sort((a, b) => a.label.localeCompare(b.label));
}
