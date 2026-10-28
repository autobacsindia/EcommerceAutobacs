/**
 * Tasks in the staff panel — "do this, by then", given to one person.
 *
 * ── Who gives tasks to whom ─────────────────────────────────────────────────
 *   admin     → anyone in the panel (active staff, or an admin)
 *   team head → themselves, or an active member of their own team
 *   member    → themselves only (their own to-do list)
 *
 * ── Who sees and changes a task ─────────────────────────────────────────────
 *   sees      the person doing it, whoever gave it, the head of its team, the admin
 *   edits     whoever gave it, the head of its team, the admin
 *             (title, notes, due day, priority, order link, archive)
 *   status    the same, plus the person doing it
 *   reassign  the head of its team (within that team) and the admin
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

const fail = (message, status) => new AppError(message, status, { expose: true });

export const TASK_PAGE_SIZE = 50;
export const COMMENT_PAGE_SIZE = 50;
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const COMMENT_MAX = 2000;
/** Steps on one task's checklist, and how long one step may be. */
export const CHECKLIST_MAX = 30;
export const CHECK_TEXT_MAX = 200;
/** One task can go to this many people at once (each gets their own copy). */
export const MAX_ASSIGNEES = 30;
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

/** May `actor` give a task to `target` (a loaded user)? */
export function mayAssignTo(actor, target) {
  if (!target || !(isAdmin(target) || isActiveStaff(target))) return false;
  if (isAdmin(actor)) return true;
  if (same(actor._id, target._id)) return isActiveStaff(actor);
  return isHead(actor) && isActiveStaff(target) && target.staff.team === actor.staff.team;
}

export const canSee = (u, t) => isAdmin(u) || same(u?._id, t.assignee) || same(u?._id, t.createdBy) || headOf(u, t.team);
export const canEdit = (u, t) => isAdmin(u) || same(u?._id, t.createdBy) || headOf(u, t.team);
const canSetStatus = (u, t) => canEdit(u, t) || same(u?._id, t.assignee);
const canReassign = (u, t) => isAdmin(u) || headOf(u, t.team);

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
export function cleanDueOn(raw) {
  if (raw == null || raw === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCDate() !== Number(m[3]) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) {
    throw fail('Pick a valid due date.', 400);
  }
  return m[0];
}

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
    throw fail(isHead(actor)
      ? 'You can give tasks only to people in your own team.'
      : 'Only team heads and the admin give tasks to other people. You can add tasks for yourself.', 403);
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
    throw fail(isHead(actor)
      ? 'You can give tasks only to people in your own team.'
      : 'Only team heads and the admin give tasks to other people. You can add tasks for yourself.', 403);
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
    },
    ...(full && {
      checklistItems: (t.checklist || []).map((c) => ({
        id: idOf(c._id), text: c.text, done: !!c.done, doneAt: c.doneAt || null, doneBy: c.doneByName || '',
      })),
      history: [...(t.history || [])].reverse().map((h) => ({
        at: h.at, by: h.byName || '', action: h.action, from: h.from || '', to: h.to || '',
      })),
    }),
  };
}

const shapeComment = (c) => ({ id: idOf(c._id), by: { id: idOf(c.by), name: c.byName || '' }, text: c.text, createdAt: c.createdAt });

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
export async function listTasks(actor, { view = 'mine', state = 'open', due, assignee, team, cursor } = {}) {
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

  const today = todayIST();
  let range = null;
  if (due && state === 'open') {
    if (due === 'overdue') range = { $lt: today };
    else if (due === 'today') range = { $gte: today, $lte: today };
    else if (due === 'late') range = { $lte: today };
  }

  const rows = await staffTaskRepository.page(query, { after: decodeCursor(cursor), limit: TASK_PAGE_SIZE + 1, range });
  const more = rows.length > TASK_PAGE_SIZE;
  const tasks = more ? rows.slice(0, TASK_PAGE_SIZE) : rows;
  return {
    tasks: tasks.map((t) => shape(t, actor, { today })),
    nextCursor: more ? encodeCursor(tasks[tasks.length - 1]) : null,
  };
}

/** Who `actor` may give a task to, for the form's picker. */
export async function listAssignees(actor) {
  let people;
  if (isAdmin(actor)) people = await userRepository.findChatUsers();
  else if (isHead(actor)) people = await userRepository.findActiveStaff(actor.staff.team);
  else people = [actor];
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
 * @param {{ title, description?, priority?, dueOn?, assigneeId?, assigneeIds?, orderId?, clientId? }} input
 * @returns {Promise<{ task: object, tasks: object[], duplicate: boolean }>}
 */
export async function createTask(actor, input = {}, req) {
  const clientId = cleanClientId(input.clientId);
  const title = cleanTitle(input.title);
  const description = cleanDescription(input.description);
  const priority = input.priority == null || input.priority === '' ? 'normal' : cleanEnum(input.priority, TASK_PRIORITIES, 'priority');
  const dueOn = cleanDueOn(input.dueOn);
  const checklist = cleanChecklist(input.checklist);
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
        status: 'todo',
        dueOn,
        assignee: person._id,
        assigneeName: person.name || '',
        team: teamOf(person),
        createdBy: actor._id,
        createdByName: actor.name || '',
        order,
        checklist,
        group,
        groupSize: many ? people.length : undefined,
        ...placeOf({ status: 'todo', dueOn }),
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
 * @param {{ rev: number, title?, description?, priority?, dueOn?, orderId?, status?, assigneeId?, archived? }} input
 */
export async function updateTask(actor, id, input = {}, req) {
  const t = await loadVisible(actor, id);
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
  const editing = ['title', 'description', 'priority', 'dueOn', 'orderId', 'status', 'assigneeId'].some(has);
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
    if (!canReassign(actor, t)) throw fail('Only the team head or the admin can give this task to someone else.', 403);
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

export async function listComments(actor, id, { before } = {}) {
  const t = await loadVisible(actor, id);
  if (before && !mongoose.isValidObjectId(before)) throw fail('Invalid page cursor.', 400);
  const rows = await staffTaskRepository.pageComments(t._id, {
    before: before ? new mongoose.Types.ObjectId(before) : null,
    limit: COMMENT_PAGE_SIZE + 1,
  });
  const more = rows.length > COMMENT_PAGE_SIZE;
  const comments = more ? rows.slice(0, COMMENT_PAGE_SIZE) : rows;
  return { comments: comments.map(shapeComment), nextBefore: more ? idOf(comments[comments.length - 1]._id) : null };
}

/** @returns {Promise<{ comment: object, duplicate: boolean }>} */
export async function addComment(actor, id, { text, clientId: rawClientId } = {}) {
  const t = await loadVisible(actor, id);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  const clientId = cleanClientId(rawClientId);
  if (clientId) {
    const seen = await staffTaskRepository.findCommentByClientId(actor._id, clientId);
    if (seen) return { comment: shapeComment(seen), duplicate: true };
  }
  const body = String(text ?? '').trim();
  if (!body) throw fail('Write a comment first.', 400);
  if (body.length > COMMENT_MAX) throw fail(`Keep a comment under ${COMMENT_MAX} characters.`, 400);

  let c;
  try {
    c = await staffTaskRepository.createComment({ task: t._id, by: actor._id, byName: actor.name || '', text: body, clientId });
  } catch (err) {
    if (err?.code === 11000 && clientId) {
      const seen = await staffTaskRepository.findCommentByClientId(actor._id, clientId);
      if (seen) return { comment: shapeComment(seen), duplicate: true };
    }
    throw err;
  }
  await staffTaskRepository.noteComment(t._id, c.createdAt);
  return { comment: shapeComment(c), duplicate: false };
}
