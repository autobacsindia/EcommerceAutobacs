/**
 * The task Inbox: what happened on your tasks, for you to read later.
 *
 * Rows are written by services/staffTaskService.js (`toInbox`) at the same
 * moments the pop-ups go out — new task, status change, comment, @mention, a
 * sub-task added — never to the person who did it. This file is the reading
 * side: your rows only, newest first, marked read, unread or cleared.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - you see and change only your own rows; anyone else's is "not found"
 *   - "Mark all read" marks what you were looking at (up to the newest row you
 *     had), so a line that arrives a second later stays unread
 *   - a line whose task you can no longer open stays readable (its number and
 *     title were copied in) and says so, rather than leading to an error
 *   - pages are keyset on _id and bounded; the unread count is capped
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffTaskInboxRepository, { INBOX_UNREAD_CAP, PROJECT_INBOX_KINDS, FOLLOWUP_INBOX_KINDS } from '../repositories/staffTaskInboxRepository.js';
import { canSee } from './staffTaskService.js';
import { seesProject } from './staffProjectService.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';

export const INBOX_PAGE_SIZE = 30;
export { INBOX_UNREAD_CAP };

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const objectId = (raw, message) => {
  if (!mongoose.isValidObjectId(raw)) throw fail(message, 400);
  return new mongoose.Types.ObjectId(String(raw));
};

const aboutProject = (row) => PROJECT_INBOX_KINDS.includes(row.kind);

/** A project line ("added you to …"): the project's live name when you still see it. */
function shapeProjectItem(row, project, viewer) {
  const canOpen = seesProject(viewer, project);
  return {
    id: idOf(row._id),
    kind: row.kind,
    task: null,
    project: { id: idOf(row.project), name: canOpen ? project.name : row.title },
    by: row.by ? { id: idOf(row.by), name: row.byName || '' } : null,
    text: row.text || '',
    read: row.state !== 'unread',
    at: row.createdAt,
    canOpen,
  };
}

/** One row as the browser sees it; the task's live title when it still opens. */
function shapeItem(row, task, viewer) {
  const canOpen = !!task && canSee(viewer, task);
  return {
    id: idOf(row._id),
    kind: row.kind,
    project: null,
    task: {
      id: idOf(row.task),
      code: `T-${row.number}`,
      title: canOpen ? task.title : row.title,
    },
    by: row.by ? { id: idOf(row.by), name: row.byName || '' } : null,
    text: row.text || '',
    read: row.state !== 'unread',
    at: row.createdAt,
    canOpen,
  };
}

export const countUnread = (user) => staffTaskInboxRepository.countUnread(user._id, INBOX_UNREAD_CAP);

/**
 * A page of `actor`'s Inbox. `state: 'unread'` lists only unread lines; `all`
 * (the default) lists everything not cleared.
 * @returns {Promise<{ items: object[], nextCursor: string|null, unread: number }>}
 */
export async function listInbox(actor, { state = 'all', cursor } = {}) {
  if (state !== 'all' && state !== 'unread') throw fail('Invalid inbox filter.', 400);
  const before = cursor ? objectId(cursor, 'Invalid page cursor.') : null;
  const [rows, unread] = await Promise.all([
    staffTaskInboxRepository.page(actor._id, {
      states: state === 'unread' ? ['unread'] : ['unread', 'read'],
      before,
      limit: INBOX_PAGE_SIZE + 1,
    }),
    countUnread(actor),
  ]);
  const more = rows.length > INBOX_PAGE_SIZE;
  const page = more ? rows.slice(0, INBOX_PAGE_SIZE) : rows;
  // One lookup for the whole page per kind of thing, not one per line.
  const taskIds = [...new Set(page.filter((r) => !aboutProject(r)).map((r) => idOf(r.task)))];
  const projectIds = [...new Set(page.filter(aboutProject).map((r) => idOf(r.project)))];
  const [taskRows, projectRows] = await Promise.all([
    staffTaskInboxRepository.tasksFor(taskIds),
    projectIds.length ? staffProjectRepository.findByIds(projectIds) : [],
  ]);
  const tasks = new Map(taskRows.map((t) => [idOf(t._id), t]));
  const projects = new Map(projectRows.map((p) => [idOf(p._id), p]));
  return {
    items: page.map((r) => (aboutProject(r)
      ? shapeProjectItem(r, projects.get(idOf(r.project)), actor)
      : shapeItem(r, tasks.get(idOf(r.task)), actor))),
    nextCursor: more ? idOf(page[page.length - 1]._id) : null,
    unread,
  };
}

/** Mark one of your lines read, unread, or cleared (gone from the list). */
export async function setInboxState(actor, id, state) {
  if (!staffTaskInboxRepository.states.includes(state)) throw fail('Invalid inbox state.', 400);
  const row = await staffTaskInboxRepository.setState(actor._id, objectId(id, 'Inbox item not found.'), state);
  if (!row) throw fail('Inbox item not found.', 404);
  return { id: idOf(row._id), state: row.state, unread: await countUnread(actor) };
}

/** "Mark all read": every unread line up to `upTo`, the newest one the screen had. */
export async function readAllInbox(actor, upTo) {
  const marked = await staffTaskInboxRepository.readUpTo(actor._id, objectId(upTo, 'Reload the inbox and try again.'));
  return { marked, unread: await countUnread(actor) };
}

// ── The "new work" pop-up ───────────────────────────────────────────────────

/**
 * Kinds that pop up in the open panel: work given to you. Comments and status
 * changes stay quiet. Order follow-ups (FOLLOWUP_INBOX_KINDS, state `alert`) pop
 * up too — read by a second range, merged newest first.
 */
export const ALERT_KINDS = Object.freeze(['assigned', 'project_added']);

/** Where an alert opens. */
function alertHref(r, user, base) {
  if (FOLLOWUP_INBOX_KINDS.includes(r.kind)) {
    return user.role === 'admin' ? `/admin/orders?order=${encodeURIComponent(idOf(r.order))}` : '/team/orders';
  }
  return aboutProject(r)
    ? `${base}?view=project&project=${encodeURIComponent(idOf(r.project))}`
    : `${base}/${encodeURIComponent(idOf(r.task))}`;
}
/** Older than this, it is in the Inbox, not news. */
export const ALERT_WINDOW_HOURS = 24;
export const ALERTS_MAX = 5;

/**
 * The newest unread "you have a new task / were added to a project" lines, for
 * the panel's pop-up card. The browser remembers which it has shown, so each
 * pops up once per device; the line stays in the Inbox either way.
 */
export async function recentAlerts(user, now = new Date()) {
  const since = new Date(now.getTime() - ALERT_WINDOW_HOURS * 3600_000);
  const [work, followUps] = await Promise.all([
    staffTaskInboxRepository.recentUnread(user._id, ALERT_KINDS, since, ALERTS_MAX),
    staffTaskInboxRepository.recentFollowUpAlerts(user._id, since, ALERTS_MAX),
  ]);
  const rows = [...work, ...followUps]
    .sort((a, b) => (String(b._id) > String(a._id) ? 1 : String(b._id) < String(a._id) ? -1 : 0))
    .slice(0, ALERTS_MAX);
  const base = user.role === 'admin' ? '/admin/tasks' : '/team/tasks';
  return rows.map((r) => ({
    id: idOf(r._id),
    kind: r.kind,
    by: r.byName || '',
    title: aboutProject(r) || FOLLOWUP_INBOX_KINDS.includes(r.kind) ? r.title : `T-${r.number} · ${r.title}`,
    text: r.text || '',
    href: alertHref(r, user, base),
    at: r.createdAt,
  }));
}
