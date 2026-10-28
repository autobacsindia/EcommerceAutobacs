/**
 * Staff tasks — the shapes the API returns (services/staffTaskService.js on the
 * backend) and the small helpers every task screen shares.
 *
 * The API decides who may do what and says so per task in `can`; the screens only
 * hide what would be refused.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TaskBucket = 'open' | 'done' | 'archived';
export type TaskView = 'mine' | 'created' | 'team';
export type TaskDue = 'late' | 'overdue' | 'today';

export type Task = {
  id: string;
  number: number;
  code: string;
  title: string;
  /** Lists carry a short summary; the task page carries the full notes. */
  summary?: string;
  description?: string;
  status: TaskStatus;
  statusLabel: string;
  priority: TaskPriority;
  priorityLabel: string;
  /** IST calendar day, YYYY-MM-DD. */
  dueOn: string | null;
  overdue: boolean;
  dueToday: boolean;
  assignee: { id: string; name: string };
  team: string | null;
  teamLabel: string;
  createdBy: { id: string; name: string };
  order: { id: string; code: string } | null;
  /** Set when one task went to several people: each has their own copy. */
  group: { id: string; size: number } | null;
  /** How many checklist steps are ticked, of how many. */
  checklist: { done: number; total: number };
  /** The task page only: the steps themselves. */
  checklistItems?: ChecklistItem[];
  bucket: TaskBucket;
  completedAt: string | null;
  archivedAt: string | null;
  commentCount: number;
  lastCommentAt: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
  /** `status` also allows ticking steps; `checklist` is adding, renaming and removing them. */
  can: { edit: boolean; status: boolean; reassign: boolean; archive: boolean; restore: boolean; comment: boolean; checklist: boolean };
  history?: { at: string; by: string; action: string; from: string; to: string }[];
  /** The task page only: the other people's copies the viewer may see. */
  siblings?: TaskSibling[];
};

export type ChecklistItem = { id: string; text: string; done: boolean; doneAt: string | null; doneBy: string };

export type TaskSibling = {
  id: string; code: string; assignee: { id: string; name: string }; status: TaskStatus; statusLabel: string; bucket: TaskBucket;
};

export type TaskPage = { tasks: Task[]; nextCursor: string | null };

export type TaskComment = { id: string; by: { id: string; name: string }; text: string; createdAt: string };
export type CommentPage = { comments: TaskComment[]; nextBefore: string | null };

export type Assignee = { id: string; name: string; team: string | null; teamLabel: string; isHead: boolean; me: boolean };

/** "Amarnath · Marketing head", "Akash CT · Operations", "AutoBacs India (me) · Admin". */
export const personLabel = (p: Assignee) =>
  `${p.name}${p.me ? ' (me)' : ''}${p.teamLabel ? ` · ${p.teamLabel}${p.isHead ? ' head' : ''}` : ''}`;

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

export const STATUS_BADGE: Record<TaskStatus, string> = {
  todo: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-sky-100 text-sky-800',
  waiting: 'bg-amber-100 text-amber-800',
  done: 'bg-green-100 text-green-800',
};

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  urgent: 'bg-red-600 text-white',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-gray-100 text-gray-600',
  low: 'bg-gray-50 text-gray-500',
};

/** One id per form open: a double-click or a retried request then creates ONE task. */
export const newClientId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** The API refused an edit because someone else changed the task first. */
export const isConflict = (e: unknown) => (e as { status?: number })?.status === 409;

/** Today's calendar day in India, YYYY-MM-DD — what "overdue" is measured against. */
export const todayIST = (now: Date = new Date()) =>
  new Date(now.getTime() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);

/** A due day that has already gone by (the task would be overdue the moment it is saved). */
export const isPastDay = (ymd: string, today: string = todayIST()) => !!ymd && ymd < today;

/** "15 Jan" / "15 Jan 2027" for a YYYY-MM-DD due day (no timezone shift: it is a day, not an instant). */
export function formatDueDay(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const thisYear = new Date().getUTCFullYear() === y;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

/** Where a task's linked order opens: the admin's orders screen, or the team's order list. */
export const orderHrefFor = (base: string, orderId: string) =>
  (base.startsWith('/admin') ? `/admin/orders?order=${encodeURIComponent(orderId)}` : '/team/orders');
