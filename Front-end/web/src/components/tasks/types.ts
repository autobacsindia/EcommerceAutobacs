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
export type TaskView = 'mine' | 'following' | 'created' | 'team';
export type TaskDue = 'late' | 'overdue' | 'today' | 'week';
/** How a list is ordered (server-side, keyset-paged). Open tasks only; done and archived keep "most recently finished first". */
export type TaskSort = 'due' | 'newest' | 'oldest' | 'updated';
/** How the list view groups the rows it has loaded. */
export type TaskGroupBy = 'status' | 'assignee' | 'priority' | 'due' | 'none';

/** What the Tasks page is showing: whose tasks, and the filters on top. */
export type TaskFilters = {
  view: TaskView;
  due?: TaskDue | '';
  priority?: TaskPriority | '';
  q?: string;
  /** The team list only: one person's tasks. */
  assignee?: string;
  /** The admin's team list only: one team ('admin' = the admin's own). */
  team?: string;
  /** Only tasks with this tag. */
  tag?: string;
  sort?: TaskSort;
};

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
  /** When work should start (never after dueOn), YYYY-MM-DD. */
  startOn: string | null;
  /** Lower-case labels, at most TAGS_MAX. */
  tags: string[];
  overdue: boolean;
  dueToday: boolean;
  /** The first person doing it; `assignees` is everyone. */
  assignee: { id: string; name: string };
  /** Everyone doing it: one shared task, one status. */
  assignees: Person[];
  /** People who see it and hear about it without doing it. */
  followers: Person[];
  /** The viewer follows it. */
  following: boolean;
  team: string | null;
  teamLabel: string;
  createdBy: { id: string; name: string };
  order: { id: string; code: string } | null;
  /** Set when the giver chose "own copy each": each person has their own copy. */
  group: { id: string; size: number } | null;
  /** The task this is a sub-task of (its number and title; the viewer may not be allowed to open it). */
  parent?: { id: string; code: string; title: string } | null;
  /** On a parent: its sub-tasks that are not archived, and how many of them are done. */
  subtasks?: { done: number; total: number };
  /** How many checklist steps are ticked, of how many. */
  checklist: { done: number; total: number };
  /** The task page only: the steps themselves. */
  checklistItems?: ChecklistItem[];
  bucket: TaskBucket;
  completedAt: string | null;
  archivedAt: string | null;
  commentCount: number;
  lastCommentAt: string | null;
  /** The task page only: files attached to the task itself (comments carry their own). */
  files?: TaskFile[];
  createdAt: string;
  updatedAt: string;
  rev: number;
  /** `status` also allows ticking steps; `checklist` is adding, renaming and removing them. */
  /** `follow`: follow or stop following it yourself; `followers`: choose who else follows it. */
  can: {
    edit: boolean; status: boolean; reassign: boolean; archive: boolean; restore: boolean; comment: boolean; checklist: boolean; files: boolean;
    follow: boolean; followers: boolean;
    /** Add sub-tasks (never on a sub-task: one level only). */
    subtask?: boolean;
  };
  history?: { at: string; by: string; action: string; from: string; to: string }[];
  /** The task page only: the other people's copies the viewer may see. */
  siblings?: TaskSibling[];
};

/** A row under "Sub-tasks": every sub-task is listed to whoever sees the parent; `canOpen` says which they may open. */
export type Subtask = Task & { canOpen: boolean };
export type SubtaskList = { subtasks: Subtask[]; total: number; done: number };
/** Sub-tasks under one task, at most this many. */
export const SUBTASKS_MAX = 50;
/** Sub-tasks still open on `t` (not done, not archived). */
export const openSubtasks = (t: Pick<Task, 'subtasks'>) => Math.max(0, (t.subtasks?.total ?? 0) - (t.subtasks?.done ?? 0));
/**
 * Completing a task whose sub-tasks are still open is allowed, but asked first.
 * True when it may go ahead.
 */
export function confirmComplete(t: Pick<Task, 'subtasks'>): boolean {
  const n = openSubtasks(t);
  if (!n) return true;
  return window.confirm(`${n === 1 ? '1 sub-task is' : `${n} sub-tasks are`} still open. Complete anyway?`);
}

export type ChecklistItem = { id: string; text: string; done: boolean; doneAt: string | null; doneBy: string };

export type TaskSibling = {
  id: string; code: string; assignee: { id: string; name: string }; status: TaskStatus; statusLabel: string; bucket: TaskBucket;
};

/** `summary`: how many open tasks match (the open list's first page only; counting stops at 1,000). */
export type TaskPage = { tasks: Task[]; nextCursor: string | null; summary?: { count: number; capped: boolean } };

/** A file on a task or a comment. `url` is served only to people who can see the task. */
export type TaskFile = {
  url: string; name: string; mime: string; size: number; kind: 'image' | 'file';
  /** Task files only: who added it, and whether the viewer may remove it. */
  by?: { id: string; name: string }; at?: string; canRemove?: boolean;
};

export type TaskReaction = { emoji: string; count: number; mine: boolean; names: string[] };

/**
 * A comment. A deleted one keeps its place with no words or files. `editableUntil`
 * is set only for the viewer's own comment while they may still change it.
 */
export type TaskComment = {
  id: string; by: { id: string; name: string }; text: string; createdAt: string;
  editedAt: string | null; deleted: boolean; mine: boolean; editableUntil: string | null;
  mentions: { id: string; name: string }[]; files: TaskFile[]; reactions: TaskReaction[];
};
export type CommentPage = { comments: TaskComment[]; nextBefore: string | null };

export type Person = { id: string; name: string };

/** Everyone on a task, for screens that may meet a task saved before `assignees` existed. */
export const peopleOf = (t: Pick<Task, 'assignee' | 'assignees'>): Person[] => (t.assignees?.length ? t.assignees : [t.assignee]);

/** The server's limits on people (services/staffTaskService.js). */
export const MAX_ASSIGNEES = 30;
export const FOLLOWERS_MAX = 50;

export type Assignee = { id: string; name: string; team: string | null; teamLabel: string; isHead: boolean; me: boolean };

/** "Amarnath · Marketing head", "Akash CT · Operations", "AutoBacs India (me) · Admin". */
export const personLabel = (p: Assignee) =>
  `${p.name}${p.me ? ' (me)' : ''}${p.teamLabel ? ` · ${p.teamLabel}${p.isHead ? ' head' : ''}` : ''}`;

/** The server's limits (services/staffTaskService.js). */
export const TAGS_MAX = 10;
export const TAG_MAX = 24;
export const BULK_MAX = 50;

/** What the server does to a tag, so the screen shows what will be saved. */
export const cleanTag = (raw: string) => raw.replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().toLowerCase().slice(0, TAG_MAX);

export const TASK_SORTS: { value: TaskSort; label: string }[] = [
  { value: 'due', label: 'Due date' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently changed' },
];

export const TASK_GROUPINGS: { value: TaskGroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Person' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'none', label: 'No groups' },
];

/** One bulk change, as POST /staff/tasks/bulk takes it. */
export type BulkChange = Partial<{
  status: TaskStatus; priority: TaskPriority; dueOn: string | null; assigneeId: string; archived: boolean;
  addTags: string[]; removeTags: string[];
}>;
export type BulkResult = {
  results: { id: string; ok: boolean; changed?: boolean; status?: number; error?: string }[];
  changed: number; unchanged: number; failed: number;
};

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Complete' },
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

/** Files on one comment, and on one task over its life (the server checks both). */
export const COMMENT_FILES_MAX = 10;
export const TASK_FILES_MAX = 30;
/** What a task or comment file may be (the server checks the bytes too). */
export const TASK_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,text/csv,text/plain,.xlsx,.docx';
