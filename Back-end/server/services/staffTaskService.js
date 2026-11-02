/**
 * Tasks in the staff panel — "do this, by then", given to one person.
 *
 * ── Who gives tasks to whom ─────────────────────────────────────────────────
 *   anyone in the panel (active staff, or an admin) → anyone in the panel,
 *   themselves included. Never a customer, never someone whose access was removed.
 *
 * ── Who sees and changes a task ─────────────────────────────────────────────
 *   sees      the person doing it, whoever gave it, the head of its team, the admin
 *   edits     whoever gave it, the head of its team, the admin
 *             (title, notes, due day, priority, order link, archive)
 *   status    the same, plus the person doing it
 *   reassign  whoever gave it, the head of its team and the admin — to anyone
 *             in the panel (the person doing it cannot pass it on)
 *   comments  everyone who sees it
 * A task's team is the assignee's team when it was given, so a head keeps seeing
 * the work they handed out even after the member moves on.
 *
 * ── One task for several people ─────────────────────────────────────────────
 * Each person gets their OWN copy (own number, status, comments), linked by a
 * shared `group` id, so everyone is answerable for their part and the giver sees
 * who has finished. The same who-gives-to-whom rule applies to every person
 * picked; if any one of them is not allowed, nothing is created.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - a double-click or a retried request creates ONE task (and one comment):
 *     the browser sends a clientId, unique per author
 *   - two people editing at once never silently overwrite each other: every edit
 *     names the rev it was made against, and a stale one is refused (409)
 *   - nothing is deleted: "delete" archives, and history records who did what
 *   - the pop-up to a new assignee is best effort — the task is saved first, and
 *     the bell (counted from this collection) is right even if the pop-up is lost
 *   - lists are keyset-paged and bounded; nothing scans another person's rows
 */

import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import counterRepository from '../repositories/counterRepository.js';
import userRepository from '../repositories/userRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { sendToUsers } from './pushService.js';
import { orderNumber } from './invoiceService.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../models/StaffTask.js';
import { keysetPage } from '../utils/listQuery.js';
import { normalizeEmoji } from '../utils/reactions.js';
import {
  storeTaskFiles, discardTaskFiles, removeTaskFile, readTaskFile, taskFileUrl, taskFolder, basenameOf, isTaskFileName,
  TASK_FILES_MAX, COMMENT_FILES_MAX,
} from './taskFileService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const TASK_PAGE_SIZE = 50;
export const COMMENT_PAGE_SIZE = 50;
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const COMMENT_MAX = 2000;
/** How long the author may edit or delete a comment — the same as team chat (CHAT_EDIT_WINDOW_MS). */
export const COMMENT_EDIT_WINDOW_MS = 30 * 60 * 1000;
/** Different emoji on one comment, and people @mentioned in one (as chat). */
export const REACTIONS_MAX = 20;
export const MENTIONS_MAX = 20;
/** Steps on one task's checklist, and how long one step may be. */
export const CHECKLIST_MAX = 30;
export const CHECK_TEXT_MAX = 200;
/** One task can go to this many people at once (each gets their own copy). */
export const MAX_ASSIGNEES = 30;
/** Tags on one task, and how long one tag may be. */
export const TAGS_MAX = 10;
export const TAG_MAX = 24;
/** Tasks one bulk change may touch. */
export const BULK_MAX = 50;
const SUMMARY_MAX = 160;
const COUNTER = 'staffTask';
/** Open tasks with no due day sort after every dated one. */
const NO_DUE = '9999-12-31';
/** Larger than any epoch-ms we will meet, so MAX - t is positive and fixed-width. */
const TIME_MAX = 9_999_999_999_999;

export const STATUS_LABELS = Object.freeze({
  todo: 'To do',
  in_progress: 'In progress',
  waiting: 'Waiting',
  done: 'Done',
});
export const PRIORITY_LABELS = Object.freeze({ urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' });

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const same = (a, b) => !!a && !!b && idOf(a) === idOf(b);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isHead = (u) => isActiveStaff(u) && u.staff.isHead === true;
const headOf = (u, team) => !!team && isHead(u) && u.staff.team === team;
const teamOf = (u) => (isActiveStaff(u) ? u.staff.team : null);

/** Today's IST calendar day, 'YYYY-MM-DD'. */
export const todayIST = (now = new Date()) => formatIsoDateIST(now);

// ── Rules ───────────────────────────────────────────────────────────────────

const inPanel = (u) => isAdmin(u) || isActiveStaff(u);

/** May `actor` give a task to `target` (a loaded user)? Anyone in the panel, to anyone in it. */
export function mayAssignTo(actor, target) {
  return !!target && inPanel(actor) && inPanel(target);
}

export const canSee = (u, t) => isAdmin(u) || same(u?._id, t.assignee) || same(u?._id, t.createdBy) || headOf(u, t.team);
export const canEdit = (u, t) => isAdmin(u) || same(u?._id, t.createdBy) || headOf(u, t.team);
const canSetStatus = (u, t) => canEdit(u, t) || same(u?._id, t.assignee);
const canReassign = (u, t) => isAdmin(u) || same(u?._id, t.createdBy) || headOf(u, t.team);

/** The bucket a task lives in, and its sort key inside it. */
export function placeOf({ status, dueOn, completedAt, archivedAt }) {
  if (archivedAt) return { bucket: 'archived', rank: `a${String(TIME_MAX - new Date(archivedAt).getTime()).padStart(13, '0')}` };
  if (status === 'done') return { bucket: 'done', rank: `d${String(TIME_MAX - new Date(completedAt || Date.now()).getTime()).padStart(13, '0')}` };
  return { bucket: 'open', rank: dueOn || NO_DUE };
}

// ── Input ───────────────────────────────────────────────────────────────────

export function cleanTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw fail('Give the task a title.', 400);
  if (title.length > TITLE_MAX) throw fail(`Keep the title under ${TITLE_MAX} characters.`, 400);
  return title;
}

function cleanDescription(raw) {
  const text = String(raw ?? '').trim();
  if (text.length > DESCRIPTION_MAX) throw fail(`Keep the notes under ${DESCRIPTION_MAX} characters.`, 400);
  return text;
}

/** 'YYYY-MM-DD' (a real calendar day), or null to clear. */
function cleanDay(raw, what) {
  if (raw == null || raw === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  // A month or day out of range rolls over in Date.UTC ('2026-13-01' → 1 Jan 2027), so both are compared back.
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) {
    throw fail(`Pick a valid ${what} date.`, 400);
  }
  return m[0];
}
export const cleanDueOn = (raw) => cleanDay(raw, 'due');
export const cleanStartOn = (raw) => cleanDay(raw, 'start');

/** A task may start on its due day, never after it. */
function checkDates(startOn, dueOn) {
  if (startOn && dueOn && startOn > dueOn) throw fail('The start date can’t be after the due date.', 400);
}

/** One tag: lower-case, single-spaced, no leading '#'. */
export function cleanTag(raw) {
  // eslint-disable-next-line no-control-regex
  const tag = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().toLowerCase();
  if (!tag) throw fail('Write the tag first.', 400);
  if (tag.length > TAG_MAX) throw fail(`Keep a tag under ${TAG_MAX} characters.`, 400);
  return tag;
}

/** A task's whole set of tags: cleaned, each once, at most TAGS_MAX. */
export function cleanTags(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw fail('Tags must be a list.', 400);
  const tags = [...new Set(raw.map(cleanTag))];
  if (tags.length > TAGS_MAX) throw fail(`A task can have at most ${TAGS_MAX} tags.`, 400);
  return tags;
}
const sameTags = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function cleanEnum(raw, values, what) {
  if (!values.includes(raw)) throw fail(`Pick a valid ${what}.`, 400);
  return raw;
}

function cleanCheckText(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw fail('Write the step first.', 400);
  if (text.length > CHECK_TEXT_MAX) throw fail(`Keep a step under ${CHECK_TEXT_MAX} characters.`, 400);
  return text;
}

/** Steps typed when creating a task: blanks dropped, at most CHECKLIST_MAX. */
function cleanChecklist(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw fail('The checklist must be a list of steps.', 400);
  const steps = raw.map((t) => String(t ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (steps.length > CHECKLIST_MAX) throw fail(`A checklist can have at most ${CHECKLIST_MAX} steps.`, 400);
  return steps.map((t) => ({ text: cleanCheckText(t), done: false }));
}

const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

async function loadAssignee(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Pick who should do this task.', 400);
  const [target] = await userRepository.findChatUsersByIds([id]);
  if (!target) throw fail('That person is no longer in the staff panel.', 400);
  if (!mayAssignTo(actor, target)) {
    throw fail('Tasks can be given only to people in the staff panel.', 403);
  }
  return target;
}

/** Every person picked, checked BEFORE anything is written: all allowed, or nothing. */
async function loadAssignees(actor, rawIds) {
  const ids = [...new Set((rawIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [await loadAssignee(actor, actor._id)];
  if (ids.length > MAX_ASSIGNEES) throw fail(`Pick at most ${MAX_ASSIGNEES} people for one task.`, 400);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw fail('Pick who should do this task.', 400);
  const found = await userRepository.findChatUsersByIds(ids);
  const byId = new Map(found.map((u) => [idOf(u._id), u]));
  const people = ids.map((id) => byId.get(id));
  if (people.some((u) => !u)) throw fail('Someone you picked is no longer in the staff panel.', 400);
  if (people.some((u) => !mayAssignTo(actor, u))) {
    throw fail('Tasks can be given only to people in the staff panel.', 403);
  }
  return people;
}

async function loadOrderRef(raw) {
  if (raw == null || raw === '') return null;
  if (!mongoose.isValidObjectId(raw)) throw fail('That order could not be found.', 400);
  const order = await orderRepository.model.findById(raw).select('_id wpId').lean();
  if (!order) throw fail('That order could not be found.', 400);
  return { target: order._id, code: orderNumber(order) };
}

// ── Shape ───────────────────────────────────────────────────────────────────

export function shape(t, viewer, { full = false, today = todayIST() } = {}) {
  const open = t.bucket === 'open';
  const archived = t.bucket === 'archived';
  const description = t.description || '';
  return {
    id: idOf(t._id),
    number: t.number,
    code: `T-${t.number}`,
    title: t.title,
    ...(full
      ? { description }
      : { summary: description.length > SUMMARY_MAX ? `${description.slice(0, SUMMARY_MAX - 1)}…` : description }),
    status: t.status,
    statusLabel: STATUS_LABELS[t.status],
    priority: t.priority,
    priorityLabel: PRIORITY_LABELS[t.priority],
    dueOn: t.dueOn || null,
    startOn: t.startOn || null,
    tags: t.tags || [],
    overdue: open && !!t.dueOn && t.dueOn < today,
    dueToday: open && t.dueOn === today,
    assignee: { id: idOf(t.assignee), name: t.assigneeName || '' },
    team: t.team || null,
    teamLabel: t.team ? STAFF_TEAM_LABELS[t.team] || t.team : 'Admin',
    createdBy: { id: idOf(t.createdBy), name: t.createdByName || '' },
    order: t.order ? { id: idOf(t.order.target), code: t.order.code } : null,
    group: t.group ? { id: idOf(t.group), size: t.groupSize || 1 } : null,
    // List rows carry counts from the database (LIST_PROJECTION); the task page counts the steps it has.
    checklist: {
      done: t.checklistDone ?? (t.checklist || []).filter((c) => c.done).length,
      total: t.checklistTotal ?? (t.checklist || []).length,
    },
    bucket: t.bucket,
    completedAt: t.completedAt || null,
    archivedAt: t.archivedAt || null,
    commentCount: t.commentCount || 0,
    lastCommentAt: t.lastCommentAt || null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    rev: t.rev,
    can: {
      edit: !archived && canEdit(viewer, t),
      status: !archived && canSetStatus(viewer, t),
      reassign: !archived && canReassign(viewer, t),
      archive: !archived && canEdit(viewer, t),
      restore: archived && canEdit(viewer, t),
      comment: !archived && canSee(viewer, t),
      checklist: !archived && canEdit(viewer, t),
      files: !archived && canSee(viewer, t),
    },
    ...(full && {
      files: (t.files || []).map((f) => ({
        ...fileOut(t._id, f),
        by: f.byName || '',
        at: f.at || null,
        canRemove: !archived && (same(f.by, viewer?._id) || canEdit(viewer, t)),
      })),
      checklistItems: (t.checklist || []).map((c) => ({
        id: idOf(c._id), text: c.text, done: !!c.done, doneAt: c.doneAt || null, doneBy: c.doneByName || '',
      })),
      history: [...(t.history || [])].reverse().map((h) => ({
        at: h.at, by: h.byName || '', action: h.action, from: h.from || '', to: h.to || '',
      })),
    }),
  };
}

/** A stored file as the browser sees it: a URL on this API, never the storage key. */
const fileOut = (taskId, f) => ({
  url: taskFileUrl(idOf(taskId), basenameOf(f.publicId)), name: f.name, mime: f.mime, size: f.size || 0, kind: f.kind,
});

/**
 * One comment as `viewer` sees it. A deleted one keeps its place with nothing
 * in it; `editableUntil` is set only for the author, while the window is open.
 * `names` maps the ids of mentioned and reacting people to their names.
 */
function shapeComment(c, viewer, names = new Map(), now = Date.now()) {
  const deleted = !!c.deletedAt;
  const mine = same(c.by, viewer?._id);
  const until = new Date(c.createdAt).getTime() + COMMENT_EDIT_WINDOW_MS;
  const nameOf = (u) => names.get(idOf(u)) || '';
  return {
    id: idOf(c._id),
    by: { id: idOf(c.by), name: c.byName || '' },
    text: deleted ? '' : c.text || '',
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
    deleted,
    mine,
    editableUntil: mine && !deleted && until > now ? new Date(until) : null,
    mentions: deleted ? [] : (c.mentions || []).map((u) => ({ id: idOf(u), name: nameOf(u) })),
    files: deleted ? [] : (c.attachments || []).map((a) => fileOut(c.task, a)),
    reactions: deleted ? [] : (c.reactions || []).map((r) => ({
      emoji: r.emoji,
      count: r.users.length,
      mine: r.users.some((u) => same(u, viewer?._id)),
      names: r.users.map(nameOf),
    })),
  };
}

/** Names of everyone mentioned in or reacting to `comments` — one lookup for the whole page. */
async function namesFor(comments) {
  const ids = new Set();
  for (const c of comments) {
    if (c.deletedAt) continue;
    for (const u of c.mentions || []) ids.add(idOf(u));
    for (const r of c.reactions || []) for (const u of r.users) ids.add(idOf(u));
  }
  const people = await userRepository.findDisplayByIds([...ids]);
  return new Map(people.map((u) => [idOf(u._id), u.name || '']));
}
const shapeOne = async (c, viewer) => shapeComment(c, viewer, await namesFor([c]));

// ── Pop-up ──────────────────────────────────────────────────────────────────

/** "You have a new task" on the assignee's devices. Best effort; never throws. */
async function notifyAssigned(task, actor) {
  try {
    const [target] = await userRepository.findChatUsersByIds([task.assignee]);
    if (!target) return;
    const base = isAdmin(target) ? '/admin/tasks' : '/team/tasks';
    await sendToUsers(
      [{ userId: idOf(target._id), url: `${base}/${idOf(task._id)}` }],
      {
        title: `New task from ${actor.name || 'your team'}`,
        body: `T-${task.number} · ${task.title}${task.dueOn ? ` · due ${task.dueOn}` : ''}`,
        tag: `task-${idOf(task._id)}`,
      },
    );
  } catch (err) {
    console.error('[StaffTask] push failed (ignored):', err.message);
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

async function loadVisible(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Task not found.', 404);
  const t = await staffTaskRepository.findById(id);
  // Not "forbidden": a task you cannot see does not exist for you.
  if (!t || !canSee(actor, t)) throw fail('Task not found.', 404);
  return t;
}

/**
 * The other people's copies of the same task, as far as `actor` may see them —
 * the giver, a head and the admin see everyone's progress; an assignee sees the
 * copies they could open anyway.
 */
async function siblingsOf(actor, t) {
  if (!t.group) return [];
  const rows = await staffTaskRepository.findGroup(t.group);
  return rows
    .filter((r) => !same(r._id, t._id) && canSee(actor, r))
    .map((r) => ({
      id: idOf(r._id), code: `T-${r.number}`, assignee: { id: idOf(r.assignee), name: r.assigneeName || '' },
      status: r.status, statusLabel: STATUS_LABELS[r.status], bucket: r.bucket,
    }));
}

export async function getTask(actor, id) {
  const t = await loadVisible(actor, id);
  return { ...shape(t, actor, { full: true }), siblings: await siblingsOf(actor, t) };
}

const encodeCursor = (t) => Buffer.from(JSON.stringify({ r: t.rank, i: idOf(t._id) })).toString('base64url');
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const { r, i } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (typeof r !== 'string' || !mongoose.isValidObjectId(i)) throw new Error('bad');
    return { rank: r, id: new mongoose.Types.ObjectId(i) };
  } catch {
    throw fail('Invalid page cursor.', 400);
  }
}

/**
 * One page of tasks.
 *
 * @param {object} actor
 * @param {{ view?: 'mine'|'created'|'team', state?: 'open'|'done'|'archived',
 *           due?: 'overdue'|'today'|'late', assignee?: string, team?: string, cursor?: string }} opts
 *   `late` = overdue or due today. `team` narrows the admin's team view.
 */
/** "T-42", "t42" or "42" → 42; anything else → null (a title search). */
const taskNumberIn = (q) => {
  const m = /^\s*t?-?\s*(\d{1,9})\s*$/i.exec(q);
  return m ? Number(m[1]) : null;
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The IST calendar day `days` after `ymd`. */
const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/*
  The open list's order: by due date (the default — overdue first, no date
  last), by when the task was given out, or by when it last changed. Done and archived lists keep their
  own order (most recently finished first), so `sort` only applies to open tasks.
*/
export const TASK_SORTS = Object.freeze({
  newest: { field: 'createdAt', dir: -1, type: 'date' },
  oldest: { field: 'createdAt', dir: 1, type: 'date' },
  updated: { field: 'updatedAt', dir: -1, type: 'date' },
});
const TASK_COUNT_CAP = 1000;

export async function listTasks(actor, { view = 'mine', state = 'open', due, assignee, team, priority, tag, q, sort, cursor } = {}) {
  const query = { bucket: state };
  if (view === 'mine') {
    query.assignee = actor._id;
  } else if (view === 'created') {
    query.createdBy = actor._id;
  } else if (view === 'team') {
    if (isAdmin(actor)) {
      if (team) query.team = team === 'admin' ? null : team;
    } else if (isHead(actor)) {
      query.team = actor.staff.team;
    } else {
      throw fail('Only team heads and the admin see the team\'s tasks.', 403);
    }
    if (assignee) {
      if (!mongoose.isValidObjectId(assignee)) throw fail('Invalid person.', 400);
      query.assignee = new mongoose.Types.ObjectId(assignee);
    }
  } else {
    throw fail('Invalid view.', 400);
  }

  if (priority) query.priority = cleanEnum(priority, TASK_PRIORITIES, 'priority');
  if (tag) query.tags = cleanTag(tag);
  // Search stays inside the list being shown (the same person / team / bucket),
  // so it never reads other people's tasks: a T-number, or words in the title.
  const term = String(q ?? '').trim().slice(0, 100);
  if (term) {
    const number = taskNumberIn(term);
    if (number != null) query.number = number;
    else query.title = { $regex: escapeRegex(term), $options: 'i' };
  }

  const today = todayIST();
  let range = null;
  if (due && state === 'open') {
    if (due === 'overdue') range = { $lt: today };
    else if (due === 'today') range = { $gte: today, $lte: today };
    else if (due === 'late') range = { $lte: today };
    else if (due === 'week') range = { $gte: today, $lte: addDays(today, 6) };
  }

  // How many match: the open list's first page only (the done list is folded away).
  const first = !cursor && state === 'open';
  const counted = first ? staffTaskRepository.countUpTo({ ...query, ...(range ? { rank: range } : {}) }, TASK_COUNT_CAP) : null;

  if (state === 'open' && TASK_SORTS[sort]) {
    const { items, nextCursor } = await keysetPage({
      query: { ...query, ...(range ? { rank: range } : {}) },
      sorts: TASK_SORTS,
      sortName: sort,
      cursor,
      pageSize: TASK_PAGE_SIZE,
      find: staffTaskRepository.pageSorted,
    });
    return {
      tasks: items.map((t) => shape(t, actor, { today })),
      nextCursor,
      sort,
      ...(counted ? { summary: await counted } : {}),
    };
  }

  const rows = await staffTaskRepository.page(query, { after: decodeCursor(cursor), limit: TASK_PAGE_SIZE + 1, range });
  const more = rows.length > TASK_PAGE_SIZE;
  const tasks = more ? rows.slice(0, TASK_PAGE_SIZE) : rows;
  return {
    tasks: tasks.map((t) => shape(t, actor, { today })),
    nextCursor: more ? encodeCursor(tasks[tasks.length - 1]) : null,
    sort: 'due',
    ...(counted ? { summary: await counted } : {}),
  };
}

/** Who `actor` may give a task to, for the form's picker. */
export async function listAssignees(actor) {
  const people = inPanel(actor) ? await userRepository.findChatUsers() : [];
  // You first, then team heads, then everyone else — each by name.
  const order = (p) => (same(p._id, actor._id) ? 0 : isHead(p) ? 1 : 2);
  return people
    .filter((p) => mayAssignTo(actor, p))
    .sort((a, b) => order(a) - order(b) || String(a.name || '').localeCompare(String(b.name || '')))
    .map((p) => ({
      id: idOf(p._id),
      name: p.name || '',
      team: teamOf(p),
      teamLabel: isAdmin(p) ? 'Admin' : STAFF_TEAM_LABELS[teamOf(p)] || '',
      isHead: isHead(p),
      me: same(p._id, actor._id),
    }));
}

/** The page header: how many of `user`'s open tasks are late, and due today. */
export async function summaryFor(user) {
  const today = todayIST();
  const [late, dueToday] = await Promise.all([
    staffTaskRepository.countDueIn(user._id, { $lt: today }),
    staffTaskRepository.countDueIn(user._id, { $gte: today, $lte: today }),
  ]);
  return { late, today: dueToday };
}

/** The bell: open tasks given to `user` that are overdue or due today. */
export async function countDueForBell(user) {
  return staffTaskRepository.countDueBy(user._id, todayIST());
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Create a task for one person, or a copy for each of several people.
 *
 * Retries are safe: one person's copy is keyed by the browser's clientId; with
 * several people each copy is keyed by clientId + that person, so a retry after
 * a half-finished create finds the copies already made, makes only the missing
 * ones, and keeps them in the same group.
 *
 * @param {{ title, description?, priority?, dueOn?, startOn?, tags?, assigneeId?, assigneeIds?, orderId?, clientId? }} input
 * @returns {Promise<{ task: object, tasks: object[], duplicate: boolean }>}
 */
export async function createTask(actor, input = {}, req) {
  const clientId = cleanClientId(input.clientId);
  const title = cleanTitle(input.title);
  const description = cleanDescription(input.description);
  const priority = input.priority == null || input.priority === '' ? 'normal' : cleanEnum(input.priority, TASK_PRIORITIES, 'priority');
  const dueOn = cleanDueOn(input.dueOn);
  const startOn = cleanStartOn(input.startOn);
  checkDates(startOn, dueOn);
  const tags = cleanTags(input.tags);
  const checklist = cleanChecklist(input.checklist);
  // "+ Add task" inside a status group starts the task in that group (never Done).
  const status = input.status == null || input.status === '' ? 'todo' : cleanEnum(input.status, ['todo', 'in_progress', 'waiting'], 'status');
  const rawIds = Array.isArray(input.assigneeIds) && input.assigneeIds.length ? input.assigneeIds : [input.assigneeId].filter(Boolean);
  const people = await loadAssignees(actor, rawIds);
  const order = await loadOrderRef(input.orderId);

  const many = people.length > 1;
  const keyFor = (p) => (!clientId ? undefined : many ? `${clientId}.${idOf(p._id)}` : clientId);
  const earlier = clientId ? await staffTaskRepository.findByClientIds(actor._id, people.map(keyFor)) : [];
  const madeFor = new Map(earlier.map((t) => [t.clientId, t]));
  // A retry joins the group its first attempt started.
  const group = many ? (earlier.find((t) => t.group)?.group ?? new mongoose.Types.ObjectId()) : null;

  const now = new Date();
  const results = [];
  for (const person of people) {
    const key = keyFor(person);
    const existing = key && madeFor.get(key);
    if (existing) { results.push({ doc: existing, created: false }); continue; }
    const number = await counterRepository.next(COUNTER);
    try {
      const doc = await staffTaskRepository.create({
        number,
        title,
        description,
        priority,
        status,
        dueOn,
        startOn,
        ...(tags.length ? { tags } : {}),
        assignee: person._id,
        assigneeName: person.name || '',
        team: teamOf(person),
        createdBy: actor._id,
        createdByName: actor.name || '',
        order,
        checklist,
        group,
        groupSize: many ? people.length : undefined,
        ...placeOf({ status, dueOn }),
        clientId: key,
        history: [{ at: now, by: actor._id, byName: actor.name || '', action: 'created', to: person.name || '' }],
      });
      results.push({ doc, created: true });
    } catch (err) {
      // The same create arrived twice at the same moment: the unique clientId index decided.
      if (err?.code === 11000 && key) {
        const seen = await staffTaskRepository.findByClientId(actor._id, key);
        if (seen) { results.push({ doc: seen, created: false }); continue; }
      }
      throw err;
    }
  }

  for (const { doc, created } of results) {
    if (!created) continue;
    auditLogger.logAction(req, 'CREATE', 'StaffTask', doc._id, {
      number: doc.number, assignee: idOf(doc.assignee), team: doc.team, ...(group && { group: idOf(group), people: people.length }),
    });
    if (!same(doc.assignee, actor._id)) void notifyAssigned(doc, actor);
  }
  const tasks = results.map(({ doc }) => shape(doc, actor, { full: true }));
  return { task: tasks[0], tasks, duplicate: results.every((r) => !r.created) };
}

/**
 * Change a task. Only the fields present in `input` change; `rev` is required.
 *
 * @param {{ rev: number, title?, description?, priority?, dueOn?, startOn?, tags?, orderId?, status?, assigneeId?, archived? }} input
 */
export async function updateTask(actor, id, input = {}, req) {
  return applyUpdate(actor, await loadVisible(actor, id), input, req);
}

/** updateTask on a task already loaded (and visible to `actor`). */
async function applyUpdate(actor, t, input, req) {
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload the task and try again.', 400);
  if (rev !== t.rev) throw fail('Someone changed this task just now. It has been reloaded — check it and try again.', 409);

  const archived = t.bucket === 'archived';
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const set = {};
  const entries = [];
  const now = new Date();
  const by = { at: now, by: actor._id, byName: actor.name || '' };
  const note = (action, from = '', to = '') => entries.push({ ...by, action, from: String(from ?? ''), to: String(to ?? '') });

  if (has('archived')) {
    const want = input.archived === true || input.archived === 'true';
    if (want !== archived) {
      if (!canEdit(actor, t)) throw fail('Only whoever gave this task, the team head or the admin can archive it.', 403);
      set.archivedAt = want ? now : null;
      note(want ? 'archived' : 'restored');
    }
  }
  const willBeArchived = set.archivedAt !== undefined ? !!set.archivedAt : archived;
  const editing = ['title', 'description', 'priority', 'dueOn', 'startOn', 'tags', 'orderId', 'status', 'assigneeId'].some(has);
  if (editing && willBeArchived) throw fail('This task is archived. Restore it first.', 409);

  const editable = canEdit(actor, t);
  const needEdit = () => { if (!editable) throw fail('Only whoever gave this task, the team head or the admin can change it.', 403); };

  if (has('title')) {
    const title = cleanTitle(input.title);
    if (title !== t.title) { needEdit(); set.title = title; note('edited', 'title'); }
  }
  if (has('description')) {
    const description = cleanDescription(input.description);
    if (description !== (t.description || '')) { needEdit(); set.description = description; note('edited', 'notes'); }
  }
  if (has('priority')) {
    const priority = cleanEnum(input.priority, TASK_PRIORITIES, 'priority');
    if (priority !== t.priority) { needEdit(); set.priority = priority; note('priority', PRIORITY_LABELS[t.priority], PRIORITY_LABELS[priority]); }
  }
  if (has('dueOn')) {
    const dueOn = cleanDueOn(input.dueOn);
    if (dueOn !== (t.dueOn || null)) { needEdit(); set.dueOn = dueOn; note('due', t.dueOn || 'none', dueOn || 'none'); }
  }
  if (has('startOn')) {
    const startOn = cleanStartOn(input.startOn);
    if (startOn !== (t.startOn || null)) { needEdit(); set.startOn = startOn; note('start', t.startOn || 'none', startOn || 'none'); }
  }
  if (set.dueOn !== undefined || set.startOn !== undefined) {
    checkDates(set.startOn !== undefined ? set.startOn : t.startOn, set.dueOn !== undefined ? set.dueOn : t.dueOn);
  }
  if (has('tags')) {
    const tags = cleanTags(input.tags);
    const before = t.tags || [];
    if (!sameTags(tags, before)) { needEdit(); set.tags = tags; note('tags', before.join(', ') || 'none', tags.join(', ') || 'none'); }
  }
  if (has('orderId')) {
    const order = await loadOrderRef(input.orderId);
    if (idOf(order?.target) !== idOf(t.order?.target)) { needEdit(); set.order = order; note('order', t.order?.code || 'none', order?.code || 'none'); }
  }
  if (has('status')) {
    const status = cleanEnum(input.status, TASK_STATUSES, 'status');
    if (status !== t.status) {
      if (!canSetStatus(actor, t)) throw fail('Only the person doing this task, whoever gave it, the team head or the admin can move it.', 403);
      set.status = status;
      set.completedAt = status === 'done' ? now : null;
      note('status', STATUS_LABELS[t.status], STATUS_LABELS[status]);
    }
  }
  let newAssignee = null;
  if (has('assigneeId') && !same(input.assigneeId, t.assignee)) {
    if (!canReassign(actor, t)) throw fail('Only whoever gave this task, the team head or the admin can give it to someone else.', 403);
    newAssignee = await loadAssignee(actor, input.assigneeId);
    Object.assign(set, { assignee: newAssignee._id, assigneeName: newAssignee.name || '', team: teamOf(newAssignee) });
    note('assignee', t.assigneeName, newAssignee.name || '');
  }

  if (!entries.length) return shape(t, actor, { full: true });

  Object.assign(set, placeOf({
    status: set.status ?? t.status,
    dueOn: set.dueOn !== undefined ? set.dueOn : t.dueOn,
    completedAt: set.completedAt !== undefined ? set.completedAt : t.completedAt,
    archivedAt: set.archivedAt !== undefined ? set.archivedAt : t.archivedAt,
  }));

  const next = await staffTaskRepository.updateIfRev(t._id, rev, set, entries);
  if (!next) throw fail('Someone changed this task just now. It has been reloaded — check it and try again.', 409);

  auditLogger.logAction(req, set.archivedAt ? 'DELETE' : 'UPDATE', 'StaffTask', t._id, {
    number: t.number, changes: entries.map((e) => e.action),
  });
  if (newAssignee && !same(newAssignee._id, actor._id)) void notifyAssigned(next, actor);
  return shape(next, actor, { full: true });
}

// ── Many at once ────────────────────────────────────────────────────────────

const BULK_FIELDS = ['status', 'priority', 'dueOn', 'assigneeId', 'archived', 'addTags', 'removeTags'];

/** The tags a task ends up with after a bulk add / remove, in a stable order. */
function bulkTags(t, add, remove) {
  const drop = new Set(remove);
  return [...new Set([...(t.tags || []), ...add])].filter((x) => !drop.has(x));
}

/** Would `input` change nothing on `t`? Then a retried bulk change is a success, not a conflict. */
function changesNothing(t, input) {
  const has = (k) => input[k] !== undefined;
  return (!has('status') || input.status === t.status)
    && (!has('priority') || input.priority === t.priority)
    && (!has('dueOn') || input.dueOn === (t.dueOn || null))
    && (!has('assigneeId') || same(input.assigneeId, t.assignee))
    && (!has('archived') || input.archived === (t.bucket === 'archived'))
    && (!has('tags') || sameTags(input.tags, t.tags || []));
}

/**
 * The same change on several tasks (the list's "selected" bar). Each task goes
 * through updateTask's rules on its own: one refusal (no permission, archived,
 * changed by someone else) never stops the others, and the answer says per task
 * what happened. The change itself is checked first, so a malformed one touches
 * nothing.
 *
 * Retries are safe: a task that already looks the way the change wants it is
 * reported unchanged, even though its `rev` has moved on.
 *
 * @param {{ items: { id: string, rev: number }[], changes: object }} input
 * @returns {Promise<{ results: { id, ok, changed?, status?, error? }[], changed: number, unchanged: number, failed: number }>}
 *   No task bodies: the screen reloads its lists after a bulk change anyway.
 */
export async function bulkUpdate(actor, { items, changes } = {}, req) {
  if (!Array.isArray(items) || !items.length) throw fail('Pick at least one task.', 400);
  if (items.length > BULK_MAX) throw fail(`Change at most ${BULK_MAX} tasks at once.`, 400);
  const ids = items.map((i) => String(i?.id ?? ''));
  if (new Set(ids).size !== ids.length) throw fail('A task was picked twice.', 400);

  const c = changes && typeof changes === 'object' ? changes : {};
  const given = BULK_FIELDS.filter((k) => c[k] !== undefined);
  if (!given.length) throw fail('Pick what to change.', 400);
  if (given.includes('archived') && given.length > 1) throw fail('Archive or restore on its own, not with other changes.', 400);
  const base = {};
  if (c.status !== undefined) base.status = cleanEnum(c.status, TASK_STATUSES, 'status');
  if (c.priority !== undefined) base.priority = cleanEnum(c.priority, TASK_PRIORITIES, 'priority');
  if (c.dueOn !== undefined) base.dueOn = cleanDueOn(c.dueOn);
  if (c.assigneeId !== undefined) base.assigneeId = (await loadAssignee(actor, c.assigneeId))._id;
  if (c.archived !== undefined) base.archived = c.archived === true || c.archived === 'true';
  const add = c.addTags !== undefined ? cleanTags(c.addTags) : [];
  const remove = c.removeTags !== undefined ? cleanTags(c.removeTags) : [];

  const results = [];
  for (const [n, item] of items.entries()) {
    const id = ids[n];
    try {
      const t = await loadVisible(actor, id);
      const input = { ...base, ...(add.length || remove.length ? { tags: bulkTags(t, add, remove) } : {}) };
      if (changesNothing(t, input)) {
        results.push({ id, ok: true, changed: false });
        continue;
      }
      await applyUpdate(actor, t, { ...input, rev: item?.rev }, req);
      results.push({ id, ok: true, changed: true });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push({ id, ok: false, status: err.statusCode, error: err.message });
    }
  }
  const count = (f) => results.filter(f).length;
  return {
    results,
    changed: count((r) => r.ok && r.changed),
    unchanged: count((r) => r.ok && !r.changed),
    failed: count((r) => !r.ok),
  };
}

// ── Checklist ───────────────────────────────────────────────────────────────
/*
  Adding, renaming and removing steps is editing the task (whoever gave it, the
  team head, the admin). Ticking a step is doing the work, so the person doing it
  may tick too. None of it bumps `rev`, so ticking a step never makes someone's
  open edit form stale. Each change is one atomic update, so two people ticking
  different steps at the same moment both land.
*/

async function loadForChecklist(actor, id, allowed, refusal) {
  const t = await loadVisible(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (!allowed(actor, t)) throw fail(refusal, 403);
  return t;
}
const checkEntry = (actor, action, text) => ({ at: new Date(), by: actor._id, byName: actor.name || '', action, to: text });
const EDIT_REFUSAL = 'Only whoever gave this task, the team head or the admin can change its checklist.';

/** @returns {Promise<object>} the task, as the task page shows it */
export async function addChecklistItem(actor, id, { text, clientId } = {}) {
  const t = await loadForChecklist(actor, id, canEdit, EDIT_REFUSAL);
  const key = cleanClientId(clientId);
  if (key && (t.checklist || []).some((c) => c.key === key)) return getTask(actor, id);
  const clean = cleanCheckText(text);
  if ((t.checklist || []).length >= CHECKLIST_MAX) throw fail(`A checklist can have at most ${CHECKLIST_MAX} steps.`, 400);
  const next = await staffTaskRepository.pushChecklistItem(t._id, { text: clean, done: false, key }, checkEntry(actor, 'check_added', clean), CHECKLIST_MAX);
  if (!next) {
    // Lost a race: say exactly why.
    const now = await staffTaskRepository.findById(t._id);
    if (key && (now?.checklist || []).some((c) => c.key === key)) return getTask(actor, id);
    if (now?.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
    throw fail(`A checklist can have at most ${CHECKLIST_MAX} steps.`, 400);
  }
  return getTask(actor, id);
}

/** Tick / untick a step (the doer too), or rename it (editors only). */
export async function updateChecklistItem(actor, id, itemId, { done, text } = {}) {
  const t = await loadVisible(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  const item = mongoose.isValidObjectId(itemId) && (t.checklist || []).find((c) => same(c._id, itemId));
  if (!item) throw fail('That step is no longer on the checklist.', 404);
  const set = {};
  let entry = null;
  if (text !== undefined) {
    if (!canEdit(actor, t)) throw fail(EDIT_REFUSAL, 403);
    const clean = cleanCheckText(text);
    if (clean !== item.text) { set.text = clean; entry = checkEntry(actor, 'check_renamed', clean); }
  }
  if (done !== undefined) {
    if (!canSetStatus(actor, t)) throw fail('Only the person doing this task, whoever gave it, the team head or the admin can tick its steps.', 403);
    const want = done === true || done === 'true';
    if (want !== !!item.done) {
      Object.assign(set, { done: want, doneAt: want ? new Date() : null, doneByName: want ? actor.name || '' : '' });
      entry = checkEntry(actor, want ? 'checked' : 'unchecked', set.text || item.text);
    }
  }
  if (!entry) return getTask(actor, id);
  const next = await staffTaskRepository.setChecklistItem(t._id, item._id, set, entry);
  if (!next) throw fail('That step is no longer on the checklist.', 404);
  return getTask(actor, id);
}

export async function removeChecklistItem(actor, id, itemId) {
  const t = await loadForChecklist(actor, id, canEdit, EDIT_REFUSAL);
  const item = mongoose.isValidObjectId(itemId) && (t.checklist || []).find((c) => same(c._id, itemId));
  // Already gone (a double-click, or someone else removed it): the result is the same.
  if (!item) return getTask(actor, id);
  await staffTaskRepository.pullChecklistItem(t._id, item._id, checkEntry(actor, 'check_removed', item.text));
  return getTask(actor, id);
}

// ── Comments ────────────────────────────────────────────────────────────────
/*
  Everyone who sees a task may comment, @mention, react and attach files.
  The author may edit or delete their own comment for COMMENT_EDIT_WINDOW_MS
  (the same 30 minutes as team chat); nobody may change anyone else's — not the
  giver, not a head, not the admin. Both are SOFT: the earlier words stay in the
  database, and what people see is "edited" or "This comment was deleted."

  Pop-ups: a new comment goes to the person doing it and whoever gave it; anyone
  @mentioned gets "mentioned you" instead. Never to the writer, never twice for a
  retried post, never for a reaction or an edit.
*/

const peopleOnTask = async (t) => {
  const heads = t.team ? (await userRepository.findActiveStaff(t.team)).filter((u) => u.staff?.isHead) : [];
  const direct = await userRepository.findChatUsersByIds([t.assignee, t.createdBy].filter(Boolean));
  const byId = new Map([...direct, ...heads].map((u) => [idOf(u._id), u]));
  return [...byId.values()];
};

/** Who `actor` may @mention on this task: the people on it, apart from themselves. */
export async function listMentionable(actor, id) {
  const t = await loadVisible(actor, id);
  const people = (await peopleOnTask(t))
    .filter((u) => !same(u._id, actor._id))
    .map((u) => ({ id: idOf(u._id), name: u.name || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { people };
}

/** Mentions as sent (a list, or a JSON list from a form with files): each must be on the task. */
async function cleanMentions(actor, t, raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = raw ? JSON.parse(raw) : []; } catch { throw fail('Invalid mentions.', 400); }
  }
  if (list == null) return [];
  if (!Array.isArray(list) || list.some((x) => !mongoose.isValidObjectId(x))) throw fail('Invalid mentions.', 400);
  const ids = [...new Set(list.map(String))].filter((x) => !same(x, actor._id));
  if (!ids.length) return [];
  if (ids.length > MENTIONS_MAX) throw fail(`Mention at most ${MENTIONS_MAX} people in one comment.`, 400);
  const on = new Set((await peopleOnTask(t)).map((u) => idOf(u._id)));
  if (ids.some((x) => !on.has(x))) throw fail('You can only mention people on this task.', 400);
  return ids.map((x) => new mongoose.Types.ObjectId(x));
}

/** The pop-ups for a new comment. Best effort; never throws. */
async function notifyComment(t, actor, c) {
  try {
    const mentioned = new Set((c.mentions || []).map(idOf));
    const ids = [...new Set([idOf(t.assignee), idOf(t.createdBy), ...mentioned])].filter((x) => x && !same(x, actor._id));
    if (!ids.length) return;
    const people = await userRepository.findChatUsersByIds(ids);
    const who = actor.name || 'Someone';
    const said = c.text ? c.text.replace(/\s+/g, ' ').slice(0, 120) : 'Shared a file';
    const target = (u) => ({ userId: idOf(u._id), url: `${isAdmin(u) ? '/admin/tasks' : '/team/tasks'}/${idOf(t._id)}` });
    const body = `T-${t.number} · ${t.title}: ${said}`;
    const tag = `task-${idOf(t._id)}`;
    const named = people.filter((u) => mentioned.has(idOf(u._id)));
    const others = people.filter((u) => !mentioned.has(idOf(u._id)));
    if (named.length) await sendToUsers(named.map(target), { title: `${who} mentioned you`, body, tag });
    if (others.length) await sendToUsers(others.map(target), { title: `${who} commented on T-${t.number}`, body, tag });
  } catch (err) {
    console.error('[StaffTask] comment push failed (ignored):', err.message);
  }
}

export async function listComments(actor, id, { before } = {}) {
  const t = await loadVisible(actor, id);
  if (before && !mongoose.isValidObjectId(before)) throw fail('Invalid page cursor.', 400);
  const rows = await staffTaskRepository.pageComments(t._id, {
    before: before ? new mongoose.Types.ObjectId(before) : null,
    limit: COMMENT_PAGE_SIZE + 1,
  });
  const more = rows.length > COMMENT_PAGE_SIZE;
  const comments = more ? rows.slice(0, COMMENT_PAGE_SIZE) : rows;
  const names = await namesFor(comments);
  const now = Date.now();
  return {
    comments: comments.map((c) => shapeComment(c, actor, names, now)),
    nextBefore: more ? idOf(comments[comments.length - 1]._id) : null,
  };
}

/**
 * Post a comment: words, files, or both. Files are stored first and removed
 * again if the comment is not saved, so nothing is left in storage unreferenced.
 * @returns {Promise<{ comment: object, duplicate: boolean }>}
 */
export async function addComment(actor, id, { text, clientId: rawClientId, mentions, files = [] } = {}) {
  const t = await loadVisible(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  const clientId = cleanClientId(rawClientId);
  if (clientId) {
    const seen = await staffTaskRepository.findCommentByClientId(actor._id, clientId);
    if (seen) return { comment: await shapeOne(seen, actor), duplicate: true };
  }
  const body = String(text ?? '').trim();
  if (!body && !files.length) throw fail('Write a comment first.', 400);
  if (body.length > COMMENT_MAX) throw fail(`Keep a comment under ${COMMENT_MAX} characters.`, 400);
  if (files.length > COMMENT_FILES_MAX) throw fail(`Attach at most ${COMMENT_FILES_MAX} files to one comment.`, 400);
  const mentionIds = await cleanMentions(actor, t, mentions);
  const stored = await storeTaskFiles(files, idOf(t._id));

  let c;
  try {
    c = await staffTaskRepository.createComment({
      task: t._id, by: actor._id, byName: actor.name || '', text: body, clientId,
      ...(mentionIds.length ? { mentions: mentionIds } : {}),
      ...(stored.length ? { attachments: stored } : {}),
    });
  } catch (err) {
    await discardTaskFiles(stored);
    if (err?.code === 11000 && clientId) {
      const seen = await staffTaskRepository.findCommentByClientId(actor._id, clientId);
      if (seen) return { comment: await shapeOne(seen, actor), duplicate: true };
    }
    throw err;
  }
  await staffTaskRepository.noteComment(t._id, c.createdAt);
  await notifyComment(t, actor, c);
  return { comment: await shapeOne(c, actor), duplicate: false };
}

const commentWindowStart = (now = Date.now()) => new Date(now - COMMENT_EDIT_WINDOW_MS);
const WINDOW_MINUTES = Math.round(COMMENT_EDIT_WINDOW_MS / 60000);

/**
 * A comment the actor is about to change. Order matters: "no such task for you"
 * (404) before "not yours" (403) before "too late", so nobody learns anything
 * about a comment they could not read.
 */
async function loadComment(actor, id, commentId) {
  const t = await loadVisible(actor, id);
  if (!mongoose.isValidObjectId(commentId)) throw fail('Comment not found.', 404);
  const c = await staffTaskRepository.findComment(t._id, commentId);
  if (!c) throw fail('Comment not found.', 404);
  return { t, c };
}
async function loadOwnComment(actor, id, commentId) {
  const found = await loadComment(actor, id, commentId);
  if (!same(found.c.by, actor._id)) throw fail('You can only change your own comments.', 403);
  return found;
}
function assertCommentWindow(c) {
  if (new Date(c.createdAt).getTime() < commentWindowStart().getTime()) {
    throw fail(`Comments can only be changed within ${WINDOW_MINUTES} minutes of posting.`, 403);
  }
}

/** Change your own comment's words. Mentions and files stay; nobody is notified again. */
export async function editComment(actor, id, commentId, { text } = {}) {
  const { c } = await loadOwnComment(actor, id, commentId);
  if (c.deletedAt) throw fail('This comment was deleted.', 409);
  assertCommentWindow(c);
  const body = String(text ?? '').trim();
  if (!body && !(c.attachments || []).length) throw fail('A comment needs some words — delete it instead.', 400);
  if (body.length > COMMENT_MAX) throw fail(`Keep a comment under ${COMMENT_MAX} characters.`, 400);
  if (body === c.text) return { comment: await shapeOne(c, actor) };

  const updated = await staffTaskRepository.editComment(c._id, actor._id, { fromText: c.text, toText: body, notBefore: commentWindowStart() });
  if (!updated) {
    // Lost a race: deleted, the window closed, or another edit landed first.
    const now = await staffTaskRepository.findComment(c.task, c._id);
    if (now?.deletedAt) throw fail('This comment was deleted.', 409);
    assertCommentWindow(now);
    throw fail('This comment was changed at the same time — please try again.', 409);
  }
  return { comment: await shapeOne(updated, actor) };
}

/** Delete your own comment. Deleting one already deleted is a success: it is gone, as wanted. */
export async function deleteComment(actor, id, commentId) {
  const { c } = await loadOwnComment(actor, id, commentId);
  if (c.deletedAt) return { comment: shapeComment(c, actor) };
  assertCommentWindow(c);
  const updated = await staffTaskRepository.deleteComment(c._id, actor._id, { notBefore: commentWindowStart() });
  if (!updated) {
    const now = await staffTaskRepository.findComment(c.task, c._id);
    if (now?.deletedAt) return { comment: shapeComment(now, actor) };
    assertCommentWindow(now);
    throw fail('Could not delete the comment — please try again.', 409);
  }
  return { comment: shapeComment(updated, actor) };
}

/** Put the actor's reaction on (`on`, the default) or take it off. Says what it should BE, so a retry is harmless. */
export async function reactToComment(actor, id, commentId, { emoji, on = true } = {}) {
  const { c } = await loadComment(actor, id, commentId);
  const e = normalizeEmoji(emoji);
  if (!e) throw fail('Pick an emoji.', 400);
  if (c.deletedAt) throw fail('This comment was deleted.', 409);
  const want = on !== false;
  const updated = await staffTaskRepository.setCommentReaction(c._id, actor._id, e, want, REACTIONS_MAX);
  if (!updated) throw fail('This comment was deleted.', 409);
  if (want && !(updated.reactions || []).some((r) => r.emoji === e)) {
    throw fail(`A comment can have up to ${REACTIONS_MAX} different reactions.`, 400);
  }
  return { comment: await shapeOne(updated, actor) };
}

// ── Files on the task ───────────────────────────────────────────────────────
/*
  Anyone who sees the task may add files; the person who added one, or anyone
  who may edit the task, removes it. Adding and removing never bump `rev`, and
  both are in the history. Removing deletes the stored bytes.
*/

/** Add files to the task. Stored first, then listed on the task; a refused write removes them again. */
export async function addTaskFiles(actor, id, files = []) {
  const t = await loadVisible(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (!files.length) throw fail('Pick a file first.', 400);
  if (files.length > COMMENT_FILES_MAX) throw fail(`Add at most ${COMMENT_FILES_MAX} files at a time.`, 400);
  if ((t.files || []).length + files.length > TASK_FILES_MAX) throw fail(`A task can have at most ${TASK_FILES_MAX} files.`, 400);

  const stored = await storeTaskFiles(files, idOf(t._id));
  const at = new Date();
  const refs = stored.map((f) => ({ ...f, by: actor._id, byName: actor.name || '', at }));
  const entries = refs.map((f) => ({ at, by: actor._id, byName: actor.name || '', action: 'file_added', to: f.name }));
  const next = await staffTaskRepository.pushFiles(t._id, refs, entries, TASK_FILES_MAX);
  if (!next) {
    await discardTaskFiles(stored);
    const now = await staffTaskRepository.findById(t._id);
    if (now?.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
    throw fail(`A task can have at most ${TASK_FILES_MAX} files.`, 400);
  }
  return getTask(actor, id);
}

/** Remove one of the task's files. Already gone is the same result, not an error. */
export async function removeTaskFileFrom(actor, id, name) {
  const t = await loadVisible(actor, id);
  if (!isTaskFileName(name)) throw fail('File not found.', 404);
  const publicId = `${taskFolder(idOf(t._id))}/${name}`;
  const file = (t.files || []).find((f) => f.publicId === publicId);
  if (!file) return getTask(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (!same(file.by, actor._id) && !canEdit(actor, t)) {
    throw fail('Only the person who added this file, or someone who can edit the task, can remove it.', 403);
  }
  const entry = { at: new Date(), by: actor._id, byName: actor.name || '', action: 'file_removed', from: file.name };
  if (await staffTaskRepository.pullFile(t._id, publicId, entry)) await removeTaskFile(file);
  return getTask(actor, id);
}

/**
 * The bytes of a file on the task or on one of its comments, for someone who
 * sees the task. A file that was removed, or whose comment was deleted, is 404.
 */
export async function readFileOf(actor, id, name) {
  const t = await loadVisible(actor, id);
  if (!isTaskFileName(name)) throw fail('File not found.', 404);
  const publicId = `${taskFolder(idOf(t._id))}/${name}`;
  const listed = (t.files || []).some((f) => f.publicId === publicId)
    || await staffTaskRepository.hasLiveCommentFile(t._id, publicId);
  if (!listed) throw fail('File not found.', 404);
  return readTaskFile(idOf(t._id), name);
}
