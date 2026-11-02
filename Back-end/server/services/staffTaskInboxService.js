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
import staffTaskInboxRepository from '../repositories/staffTaskInboxRepository.js';
import { canSee } from './staffTaskService.js';

export const INBOX_PAGE_SIZE = 30;
/** The badge stops counting here and shows "99+". */
export const INBOX_UNREAD_CAP = 100;

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const objectId = (raw, message) => {
  if (!mongoose.isValidObjectId(raw)) throw fail(message, 400);
  return new mongoose.Types.ObjectId(String(raw));
};

/** One row as the browser sees it; the task's live title when it still opens. */
function shapeItem(row, task, viewer) {
  const canOpen = !!task && canSee(viewer, task);
  return {
    id: idOf(row._id),
    kind: row.kind,
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
  // One lookup for the whole page, not one per line.
  const taskIds = [...new Set(page.map((r) => idOf(r.task)))];
  const tasks = new Map((await staffTaskInboxRepository.tasksFor(taskIds)).map((t) => [idOf(t._id), t]));
  return {
    items: page.map((r) => shapeItem(r, tasks.get(idOf(r.task)), actor)),
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
