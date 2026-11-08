/**
 * Tasks in the staff panel — "do this, by then", given to one person or several.
 *
 * ── Who gives tasks to whom ─────────────────────────────────────────────────
 *   anyone in the panel (active staff, or an admin) → anyone in the panel,
 *   themselves included. Never a customer, never someone whose access was removed.
 *
 * ── Who sees and changes a task ─────────────────────────────────────────────
 *   sees      the people doing it, its followers, whoever gave it, the head of
 *             any team someone on it belongs to, the admin
 *   edits     whoever gave it, those heads, the admin
 *             (title, notes, due day, priority, order link, people, archive)
 *   status    the same, plus the people doing it — never a follower
 *   people    whoever gave it, those heads and the admin — anyone in the panel
 *             (the people doing it cannot pass it on)
 *   follow    anyone who sees it may follow or stop following it themselves;
 *             the editors may add or remove anyone in the panel
 *   comments  everyone who sees it
 * A task's teams are its people's teams when they were given it, so a head keeps
 * seeing the work they handed out even after the member moves on.
 *
 * ── One task for several people ─────────────────────────────────────────────
 * By default (`shared`) it is ONE task with several people in `assignees`: one
 * number, one status, one conversation. "Own copy each" still makes a copy per
 * person (own number, status, comments), linked by a `group` id, so everyone is
 * answerable for their part. Either way the who-gives-to-whom rule applies to
 * every person picked; if any one of them is not allowed, nothing is created.
 *
 * ── Pop-ups ─────────────────────────────────────────────────────────────────
 * To the people doing it, its followers and whoever gave it — never to the person
 * who did the thing, and only after the change was really saved, so a retried
 * request never sends a second one. New people hear "new task"; everyone hears
 * a status change and a comment; someone @mentioned hears "mentioned you".
 * Each also lands in that person's Inbox (services/staffTaskInboxService.js),
 * written BEFORE the pop-up and keyed by the event, so a pop-up lost on a closed
 * tab is still there to read, and a retry never writes a line twice.
 *
 * ── Sub-tasks ───────────────────────────────────────────────────────────────
 * A sub-task is a whole task (its own people, status, comments) that names its
 * parent. One level only. Whoever may edit the parent adds them, at most
 * SUBTASKS_MAX; the people on one follow the same rule as any task. Each shows
 * in its people's lists like any task, with the parent's name. Whoever sees the
 * parent sees its sub-tasks listed under it, but opens only those they may see.
 * Archiving a parent archives its sub-tasks; restoring it brings back exactly
 * those it took. The parent's "1/2" is counted from the sub-tasks after every
 * change to one of them, never kept by adding.
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
import staffTaskInboxRepository, { INBOX_UNREAD_CAP } from '../repositories/staffTaskInboxRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import staffTaskTimeRepository from '../repositories/staffTaskTimeRepository.js';
import { sendToUsers } from './pushService.js';
import { listForTask, liveList } from './staffTaskListService.js';
import { orderNumber } from './invoiceService.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { TASK_PICKABLE_STATUSES, TASK_PRIORITIES, shownStatus } from '../models/StaffTask.js';
import { keysetPage } from '../utils/listQuery.js';
import { normalizeEmoji } from '../utils/reactions.js';
import {
  storeTaskFiles, discardTaskFiles, removeTaskFile, readTaskFile, taskFileUrl, taskFolder, basenameOf, isTaskFileName,
  TASK_FILES_MAX, COMMENT_FILES_MAX,
} from './taskFileService.js';
import { cleanRichText, richTextLength, richTextToPlain, RICH_TEXT_MARKUP_FACTOR } from '../utils/richText.js';
import staffTaskLinkRepository from '../repositories/staffTaskLinkRepository.js';

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
/** Followers on one task. */
export const FOLLOWERS_MAX = 50;
/** Tags on one task, and how long one tag may be. */
export const TAGS_MAX = 10;
export const TAG_MAX = 24;
/** Sub-tasks under one task (not counting archived ones). */
export const SUBTASKS_MAX = 50;
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
const IST_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The IST time now, 'HH:mm' (24-hour) — compared with a task's `dueTime`. */
export const timeIST = (now = new Date()) => IST_CLOCK.format(now);
/** A due day and time as one sort key / history value: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm'. */
const dueKey = (dueOn, dueTime) => (dueOn ? (dueTime ? `${dueOn} ${dueTime}` : dueOn) : null);

// ── Rules ───────────────────────────────────────────────────────────────────

const inPanel = (u) => isAdmin(u) || isActiveStaff(u);

/** May `actor` give a task to `target` (a loaded user)? Anyone in the panel, to anyone in it. */
export function mayAssignTo(actor, target) {
  return !!target && inPanel(actor) && inPanel(target);
}

/*
  The people on a task. `assignees` / `teams` are the truth; a task without them
  (made before phase 4 and missed by the backfill) still answers from its one
  `assignee` / `team`, so a rule never locks anyone out of it.
*/
export const peopleOf = (t) => t.assignees ?? (t.assignee ? [{ user: t.assignee, name: t.assigneeName || '' }] : []);
const teamsOf = (t) => t.teams ?? [t.team ?? null];
const followersOf = (t) => t.followers ?? [];
const isDoing = (u, t) => peopleOf(t).some((p) => same(u?._id, p.user));
const isFollowing = (u, t) => followersOf(t).some((p) => same(u?._id, p.user));
const headOnTask = (u, t) => teamsOf(t).some((team) => headOf(u, team));
// Like a Google Chat space: everyone in a team sees the team's tasks (seeing,
// commenting and following — changing one stays with canEdit).
const teamOnTask = (u, t) => !!teamOf(u) && teamsOf(t).includes(teamOf(u));

/** A Personal-list task belongs to its maker alone: this comes before every other rule, the admin's included. */
const ownPersonal = (u, t) => same(u?._id, t.createdBy);
export const canSee = (u, t) => (t.personal ? ownPersonal(u, t) : isAdmin(u) || isDoing(u, t) || isFollowing(u, t) || same(u?._id, t.createdBy) || teamOnTask(u, t));
export const canEdit = (u, t) => (t.personal ? ownPersonal(u, t) : isAdmin(u) || same(u?._id, t.createdBy) || headOnTask(u, t));
const canSetStatus = (u, t) => canEdit(u, t) || isDoing(u, t);
const canReassign = (u, t) => !t.personal && canEdit(u, t);

/** The bucket a task lives in, and its sort key inside it. */
export function placeOf({ status, dueOn, dueTime, completedAt, archivedAt }) {
  if (archivedAt) return { bucket: 'archived', rank: `a${String(TIME_MAX - new Date(archivedAt).getTime()).padStart(13, '0')}` };
  if (status === 'done') return { bucket: 'done', rank: `d${String(TIME_MAX - new Date(completedAt || Date.now()).getTime()).padStart(13, '0')}` };
  return { bucket: 'open', rank: dueKey(dueOn, dueTime) || NO_DUE };
}

// ── Input ───────────────────────────────────────────────────────────────────

export function cleanTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw fail('Give the task a title.', 400);
  if (title.length > TITLE_MAX) throw fail(`Keep the title under ${TITLE_MAX} characters.`, 400);
  return title;
}

/**
 * Notes and comments may be formatted (HTML from the rich-text box) or plain
 * text (everything older). Formatted HTML is cleaned to the allow-list; the
 * limit counts words, not markup, and an absurd payload is refused before
 * anything parses it.
 */
function cleanRich(raw, max, tooLong) {
  const s = String(raw ?? '');
  if (s.length > max * RICH_TEXT_MARKUP_FACTOR) throw fail(tooLong, 400);
  const text = cleanRichText(s);
  if (richTextLength(text) > max) throw fail(tooLong, 400);
  return text;
}

function cleanDescription(raw) {
  return cleanRich(raw, DESCRIPTION_MAX, `Keep the notes under ${DESCRIPTION_MAX} characters.`);
}

const cleanCommentText = (raw) => cleanRich(raw, COMMENT_MAX, `Keep a comment under ${COMMENT_MAX} characters.`);

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
/** A due time, 'HH:mm' 24-hour IST, or null. */
export function cleanDueTime(raw) {
  if (raw == null || raw === '') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(raw));
  if (!m) throw fail('Pick a valid due time.', 400);
  return m[0];
}

/** A task may start on its due day, never after it. */
function checkDates(startOn, dueOn) {
  if (startOn && dueOn && startOn > dueOn) throw fail('The start date can’t be after the due date.', 400);
}

/** One tag: lower-case, single-spaced, no leading '#'. */
export const ESTIMATE_MAX = 60000; // 1000 hours
/** An estimate in whole minutes, or null for none. */
export function cleanEstimate(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > ESTIMATE_MAX) throw fail('Enter an estimate between 1 minute and 1000 hours.', 400);
  return n;
}

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

/**
 * Everything a task stores about who is doing it, from loaded users: the list,
 * each of their teams once, and the first person in the old one-person fields
 * (kept for older code and the 4a rollback; nothing decides on them).
 */
export const peopleFields = (people) => personFields(people.map((p) => ({ user: p._id, name: p.name || '', team: teamOf(p) })));
/** The same, from `{ user, name, team }` entries (some kept from the task, some just loaded). */
const personFields = (list) => ({
  assignee: list[0].user,
  assigneeName: list[0].name,
  team: list[0].team,
  assignees: list.map(({ user, name, team }) => ({ user, name, team })),
  teams: [...new Set(list.map((p) => p.team))],
});
const namesOf = (list) => list.map((p) => p.name || '?').join(', ');

async function loadOrderRef(raw) {
  if (raw == null || raw === '') return null;
  if (!mongoose.isValidObjectId(raw)) throw fail('That order could not be found.', 400);
  const order = await orderRepository.model.findById(raw).select('_id wpId').lean();
  if (!order) throw fail('That order could not be found.', 400);
  return { target: order._id, code: orderNumber(order) };
}

// ── Shape ───────────────────────────────────────────────────────────────────

export function shape(t, viewer, { full = false, today = todayIST(), now = timeIST() } = {}) {
  const open = t.bucket === 'open';
  // Late: an earlier day, or today once its time has come.
  const late = open && !!t.dueOn && (t.dueOn < today || (t.dueOn === today && !!t.dueTime && t.dueTime <= now));
  const archived = t.bucket === 'archived';
  const description = t.description || '';
  // Lists show a plain preview; the task's own page gets the formatted notes.
  const summary = full ? '' : richTextToPlain(description).replace(/\s+/g, ' ');
  return {
    id: idOf(t._id),
    number: t.number,
    code: `T-${t.number}`,
    title: t.title,
    ...(full
      ? { description }
      : { summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary }),
    status: shownStatus(t.status),
    statusLabel: STATUS_LABELS[shownStatus(t.status)],
    priority: t.priority,
    priorityLabel: PRIORITY_LABELS[t.priority],
    dueOn: t.dueOn || null,
    dueTime: t.dueOn ? t.dueTime || null : null,
    startOn: t.startOn || null,
    tags: t.tags || [],
    overdue: late,
    dueToday: open && t.dueOn === today,
    // The first person, for screens that show one; `assignees` is everyone.
    assignee: { id: idOf(peopleOf(t)[0]?.user), name: peopleOf(t)[0]?.name || '' },
    assignees: peopleOf(t).map((p) => ({ id: idOf(p.user), name: p.name || '' })),
    followers: followersOf(t).map((p) => ({ id: idOf(p.user), name: p.name || '' })),
    following: isFollowing(viewer, t),
    team: t.team || null,
    teamLabel: t.personal ? 'Personal' : t.team ? STAFF_TEAM_LABELS[t.team] || t.team : 'Admin',
    personal: !!t.personal,
    estimateMinutes: t.estimateMinutes ?? null,
    createdBy: { id: idOf(t.createdBy), name: t.createdByName || '' },
    order: t.order ? { id: idOf(t.order.target), code: t.order.code } : null,
    group: t.group ? { id: idOf(t.group), size: t.groupSize || 1 } : null,
    list: idOf(t.list),
    // The parent's number and title travel with the sub-task, so a row can say
    // "in T-20 …" even to someone who may not open T-20.
    parent: t.parent ? { id: idOf(t.parent.task), code: `T-${t.parent.number}`, title: t.parent.title || '' } : null,
    subtasks: { total: t.subtasks?.total ?? 0, done: t.subtasks?.done ?? 0 },
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
      // Following yourself: anyone who sees it. Choosing who else follows: the editors.
      follow: !t.personal && canSee(viewer, t),
      followers: !archived && !t.personal && canEdit(viewer, t),
      // One level only: a sub-task has no sub-tasks of its own.
      subtask: !archived && !t.parent && canEdit(viewer, t),
      // Anyone who sees a task may track time on it (services/staffTaskTimeService.js).
      time: !archived && canSee(viewer, t),
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
    assignment: deleted || !c.assignedTo ? null : {
      to: { id: idOf(c.assignedTo), name: nameOf(c.assignedTo) },
      by: { id: idOf(c.assignedBy), name: nameOf(c.assignedBy) },
      at: c.assignedAt,
      resolvedAt: c.resolvedAt || null,
      resolvedBy: c.resolvedBy ? nameOf(c.resolvedBy) : '',
      canChange: mine || same(c.assignedTo, viewer?._id) || same(c.assignedBy, viewer?._id) || !!c.viewerEdits,
    },
  };
}

/** Names of everyone mentioned in or reacting to `comments` — one lookup for the whole page. */
async function namesFor(comments) {
  const ids = new Set();
  for (const c of comments) {
    if (c.deletedAt) continue;
    for (const u of c.mentions || []) ids.add(idOf(u));
    for (const r of c.reactions || []) for (const u of r.users) ids.add(idOf(u));
    for (const u of [c.assignedTo, c.assignedBy, c.resolvedBy]) if (u) ids.add(idOf(u));
  }
  const people = await userRepository.findDisplayByIds([...ids]);
  return new Map(people.map((u) => [idOf(u._id), u.name || '']));
}
const shapeOne = async (c, viewer) => shapeComment(c, viewer, await namesFor([c]));

// ── Pop-up ──────────────────────────────────────────────────────────────────

/** Everyone who hears about a task: the people doing it, its followers and whoever gave it. */
const audienceOf = (t) => [...peopleOf(t).map((p) => p.user), ...followersOf(t).map((p) => p.user), t.createdBy];

/**
 * Send one pop-up to `ids` about task `t` — never to `actor`, each person once,
 * each to the panel they use. Best effort: the change is already saved, so a
 * lost pop-up never undoes it, and this never throws.
 */
async function notifyPeople(t, actor, ids, message) {
  try {
    const wanted = [...new Set(ids.map(idOf))].filter((x) => x && !same(x, actor._id));
    if (!wanted.length) return;
    const people = await userRepository.findChatUsersByIds(wanted);
    if (!people.length) return;
    await sendToUsers(
      people.map((u) => ({ userId: idOf(u._id), url: `${isAdmin(u) ? '/admin/tasks' : '/team/tasks'}/${idOf(t._id)}` })),
      { ...message, tag: `task-${idOf(t._id)}` },
    );
  } catch (err) {
    console.error('[StaffTask] push failed (ignored):', err.message);
  }
}

/**
 * Inbox lines about task `t` for `ids` — never `actor`, each person once. `key`
 * names the event, so writing the same one again (a retry) adds nothing. Best
 * effort like the pop-ups: the change is already saved, and this never throws.
 */
async function toInbox(t, actor, ids, line) {
  await toInboxAll(t, actor, [{ ids, ...line }]);
}

/** Several kinds of line about one event (a comment: "mentioned you" and "commented") in one write. */
async function toInboxAll(t, actor, parts) {
  try {
    const rows = parts.flatMap(({ ids, kind, key, text = '' }) => [...new Set(ids.map(idOf))]
      .filter((x) => x && !same(x, actor._id))
      .map((user) => ({
        user, key, kind, task: t._id, number: t.number, title: t.title,
        by: actor._id, byName: actor.name || '', text: String(text).slice(0, 200),
      })));
    await staffTaskInboxRepository.insertMany(rows);
  } catch (err) {
    console.error('[StaffTask] inbox write failed (ignored):', err.message);
  }
}

/** The event key of a change: the rev it made is unique to it. */
const revKey = (t, what) => `t:${idOf(t._id)}:r${t.rev}:${what}`;
const createdKey = (t) => `t:${idOf(t._id)}:created`;
const dueText = (t) => (t.dueOn ? `due ${dueKey(t.dueOn, t.dueTime)}` : '');

/** "You have a new task" to the people just given it: their Inbox, then a pop-up. */
async function notifyAssigned(t, actor, ids, key = revKey(t, 'assigned')) {
  await toInbox(t, actor, ids, { kind: 'assigned', key, text: dueText(t) });
  void notifyPeople(t, actor, ids, {
    title: `New task from ${actor.name || 'your team'}`,
    body: `T-${t.number} · ${t.title}${t.dueOn ? ` · ${dueText(t)}` : ''}`,
  });
}

/** "Moved to Done" to everyone on the task, apart from `skip` (just given it: they hear "new task"). */
async function notifyStatus(t, actor, skip = []) {
  const ids = audienceOf(t).filter((x) => !skip.some((y) => same(x, y)));
  await toInbox(t, actor, ids, { kind: 'status', key: revKey(t, 'status'), text: STATUS_LABELS[t.status] });
  void notifyPeople(t, actor, ids, {
    title: `${actor.name || 'Someone'} moved T-${t.number} to ${STATUS_LABELS[t.status]}`,
    body: t.title,
  });
}

/** "A sub-task was added" to everyone on the parent — Inbox only; its own people heard "new task". */
const noteSubtaskInInbox = (parent, actor, child) => toInbox(
  parent,
  actor,
  audienceOf(parent).filter((x) => !peopleOf(child).some((p) => same(p.user, x))),
  { kind: 'subtask', key: `t:${idOf(parent._id)}:sub:${idOf(child._id)}`, text: `T-${child.number} · ${child.title}` },
);

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
      status: shownStatus(r.status), statusLabel: STATUS_LABELS[shownStatus(r.status)], bucket: r.bucket,
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
 * @param {{ view?: 'mine'|'following'|'created'|'team', state?: 'open'|'done'|'archived',
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

/** Time spent on each row, from one total over the page (running timers counted up to now). */
async function withTime(rows) {
  const ids = rows.map((r) => r.id);
  const [totals, waiting] = await Promise.all([
    staffTaskTimeRepository.totalsByTask(ids, new Date()),
    staffTaskLinkRepository.openBlockerCounts(ids.map((x) => new mongoose.Types.ObjectId(x))),
  ]);
  const seconds = new Map(totals.map((x) => [idOf(x._id), x.seconds]));
  return rows.map((r) => ({ ...r, timeSeconds: seconds.get(r.id) ?? 0, waitingOn: waiting.get(r.id) ?? 0 }));
}

export async function listTasks(actor, { view = 'mine', state = 'open', due, assignee, team, list, priority, tag, q, sort, cursor } = {}) {
  const query = { bucket: state };
  if (view === 'mine') {
    query['assignees.user'] = actor._id;
  } else if (view === 'following') {
    query['followers.user'] = actor._id;
  } else if (view === 'created') {
    query.createdBy = actor._id;
  } else if (view === 'personal') {
    query.createdBy = actor._id;
    query.personal = true;
  } else if (view === 'team') {
    // Personal tasks have no team, but "All teams" has no team filter to keep them out.
    query.personal = { $ne: true };
    if (isAdmin(actor)) {
      if (team) query.teams = team === 'admin' ? null : team;
    } else if (teamOf(actor)) {
      query.teams = teamOf(actor);
    } else {
      throw fail('Only people in a team see the team\'s tasks.', 403);
    }
    // One list of the space, or its "Other tasks" — inside the team chosen above.
    if (list) {
      if (!query.teams) throw fail('Pick a team first.', 400);
      if (list === 'none') {
        query.list = null;
      } else {
        if (!mongoose.isValidObjectId(list)) throw fail('That list no longer exists.', 400);
        query.list = new mongoose.Types.ObjectId(list);
      }
    }
    if (assignee) {
      if (!mongoose.isValidObjectId(assignee)) throw fail('Invalid person.', 400);
      query['assignees.user'] = new mongoose.Types.ObjectId(assignee);
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
  const now = timeIST();
  const tomorrow = addDays(today, 1);
  /*
    Ranges over `rank` ('YYYY-MM-DD' or 'YYYY-MM-DD HH:mm'), so they stay on the
    list indexes. Overdue = before today, or today at a time already past: up to
    'today now', except an untimed 'today' (late only from tomorrow).
  */
  let range = null;
  if (due && state === 'open') {
    if (due === 'overdue') range = { $lte: `${today} ${now}`, $ne: today };
    else if (due === 'today') range = { $gte: today, $lt: tomorrow };
    else if (due === 'late') range = { $lt: tomorrow };
    else if (due === 'week') range = { $gte: today, $lt: addDays(today, 7) };
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
      tasks: await withTime(items.map((t) => shape(t, actor, { today, now }))),
      nextCursor,
      sort,
      ...(counted ? { summary: await counted } : {}),
    };
  }

  const rows = await staffTaskRepository.page(query, { after: decodeCursor(cursor), limit: TASK_PAGE_SIZE + 1, range });
  const more = rows.length > TASK_PAGE_SIZE;
  const tasks = more ? rows.slice(0, TASK_PAGE_SIZE) : rows;
  return {
    tasks: await withTime(tasks.map((t) => shape(t, actor, { today, now }))),
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
      avatarUrl: p.avatar?.url || '',
      me: same(p._id, actor._id),
    }));
}

/** The page header: how many of `user`'s open tasks are late, and due today — and unread Inbox lines (capped). */
export async function summaryFor(user) {
  const today = todayIST();
  const tomorrow = addDays(today, 1);
  // Late = earlier days + today's timed tasks whose time has come; "today" = the rest of today's.
  const [before, lateToday, allToday, inbox, assignedComments] = await Promise.all([
    staffTaskRepository.countDueIn(user._id, { $lt: today }),
    staffTaskRepository.countDueIn(user._id, { $gt: today, $lte: `${today} ${timeIST()}` }),
    staffTaskRepository.countDueIn(user._id, { $gte: today, $lt: tomorrow }),
    staffTaskInboxRepository.countUnread(user._id, INBOX_UNREAD_CAP),
    staffTaskRepository.countOpenAssignedComments(user._id, 100),
  ]);
  return { late: before + lateToday, today: allToday - lateToday, inbox, assignedComments };
}

/** The bell: open tasks given to `user` that are overdue or due today. */
export async function countDueForBell(user) {
  return staffTaskRepository.countDueBefore(user._id, addDays(todayIST(), 1));
}

// ── Write ───────────────────────────────────────────────────────────────────

/** The task a new sub-task goes under: one `actor` may edit, not archived, not itself a sub-task. */
async function loadParent(actor, id) {
  const parent = await loadVisible(actor, id);
  if (parent.parent) throw fail('A sub-task can’t have sub-tasks of its own.', 400);
  if (parent.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (!canEdit(actor, parent)) throw fail('Only whoever gave this task, the team head or the admin can add sub-tasks to it.', 403);
  return parent;
}

const subtaskEntry = (actor, action, child) => ({
  at: new Date(), by: actor._id, byName: actor.name || '', action, from: '', to: `T-${child.number} ${child.title}`,
});

/**
 * Count `parentId`'s sub-tasks and store the count on it. Counting (never
 * adding) means a lost update or a crash cannot leave it wrong for good; and
 * because two sub-tasks changing at once could each store a count read just
 * before the other's change, it counts again after storing, and stores again
 * until the two agree.
 */
export async function recountSubtasks(parentId) {
  let counts = await staffTaskRepository.countSubtasks(parentId);
  for (let i = 0; i < 3; i += 1) {
    await staffTaskRepository.setSubtaskCounts(parentId, counts);
    const again = await staffTaskRepository.countSubtasks(parentId);
    if (again.total === counts.total && again.done === counts.done) return counts;
    counts = again;
  }
  await staffTaskRepository.setSubtaskCounts(parentId, counts);
  return counts;
}

/**
 * Create a task for one person; for several, one shared task (`shared: true`)
 * or a copy each.
 *
 * Retries are safe: a single or shared task is keyed by the browser's clientId;
 * with a copy each, each copy is keyed by clientId + that person, so a retry
 * after a half-finished create finds the copies already made, makes only the
 * missing ones, and keeps them in the same group.
 *
 * `parentId` makes it a sub-task of that task (see "Sub-tasks" above).
 *
 * @param {{ title, description?, priority?, dueOn?, startOn?, tags?, assigneeId?, assigneeIds?, shared?, orderId?, parentId?, clientId? }} input
 * @param {{ note?: boolean }} [opts] `note: false` leaves the line on the parent's history to the caller
 * @returns {Promise<{ task: object, tasks: object[], duplicate: boolean }>}
 */
export async function createTask(actor, input = {}, req, { note = true } = {}) {
  const clientId = cleanClientId(input.clientId);
  const title = cleanTitle(input.title);
  const description = cleanDescription(input.description);
  const priority = input.priority == null || input.priority === '' ? 'normal' : cleanEnum(input.priority, TASK_PRIORITIES, 'priority');
  const dueOn = cleanDueOn(input.dueOn);
  const dueTime = cleanDueTime(input.dueTime);
  if (dueTime && !dueOn) throw fail('Pick a due date before a time.', 400);
  const startOn = cleanStartOn(input.startOn);
  checkDates(startOn, dueOn);
  const tags = cleanTags(input.tags);
  const checklist = cleanChecklist(input.checklist);
  const estimateMinutes = cleanEstimate(input.estimateMinutes);
  // "+ Add task" inside a status group starts the task in that group (never Done).
  const status = input.status == null || input.status === '' ? 'todo' : cleanEnum(input.status, ['todo', 'in_progress'], 'status');
  const rawIds = Array.isArray(input.assigneeIds) && input.assigneeIds.length ? input.assigneeIds : [input.assigneeId].filter(Boolean);
  const parent = input.parentId ? await loadParent(actor, input.parentId) : null;
  const askedPersonal = input.personal === true || input.personal === 'true';
  if (askedPersonal && parent && !parent.personal) throw fail('A sub-task of a shared task can’t be personal.', 400);
  // Everything under a personal task stays personal, or its title would reach others.
  const personal = askedPersonal || !!parent?.personal;
  const people = await loadAssignees(actor, personal ? [] : rawIds);
  const order = await loadOrderRef(input.orderId);

  // One shared task for everyone, unless the giver asked for a copy each.
  const shared = personal || input.shared === true || input.shared === 'true';
  const many = people.length > 1 && !shared;
  const rows = many ? people.map((p) => [p]) : [people];
  // The list must be in a space of every copy made (each copy has its person's team).
  let list = null;
  if (!personal) for (const who of rows) list = await listForTask(input.listId, peopleFields(who).teams);
  const keyFor = (who) => (!clientId ? undefined : many ? `${clientId}.${idOf(who[0]._id)}` : clientId);
  const earlier = clientId ? await staffTaskRepository.findByClientIds(actor._id, rows.map(keyFor)) : [];
  const madeFor = new Map(earlier.map((t) => [t.clientId, t]));
  // A retry joins the group its first attempt started.
  const group = many ? (earlier.find((t) => t.group)?.group ?? new mongoose.Types.ObjectId()) : null;
  if (parent) {
    // Only the ones this request would add count against the limit: a retry of a full create is still a success.
    const adding = rows.filter((who) => !madeFor.has(keyFor(who))).length;
    if (adding && (await staffTaskRepository.countSubtasks(parent._id)).total + adding > SUBTASKS_MAX) {
      throw fail(`A task can have at most ${SUBTASKS_MAX} sub-tasks.`, 400);
    }
  }

  const now = new Date();
  const results = [];
  for (const who of rows) {
    const key = keyFor(who);
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
        dueTime,
        startOn,
        ...(tags.length ? { tags } : {}),
        ...peopleFields(who),
        ...(personal ? { personal: true, team: null, teams: [] } : {}),
        ...(estimateMinutes ? { estimateMinutes } : {}),
        createdBy: actor._id,
        createdByName: actor.name || '',
        order,
        checklist,
        ...(parent && { parent: { task: parent._id, number: parent.number, title: parent.title } }),
        group,
        groupSize: many ? people.length : undefined,
        list: list?._id ?? null,
        ...placeOf({ status, dueOn, dueTime }),
        clientId: key,
        history: [{ at: now, by: actor._id, byName: actor.name || '', action: 'created', to: namesOf(peopleFields(who).assignees) }],
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
    if (!created) {
      // A retry of a create that saved but may not have reached the Inbox: write
      // it again (keyed, so nothing doubles) — unless the task has changed since,
      // when its people are no longer the ones it was made for. No second pop-up.
      if (doc.rev === 1) await toInbox(doc, actor, peopleOf(doc).map((p) => p.user), { kind: 'assigned', key: createdKey(doc), text: dueText(doc) });
      continue;
    }
    auditLogger.logAction(req, 'CREATE', 'StaffTask', doc._id, {
      number: doc.number,
      assignees: peopleOf(doc).map((p) => idOf(p.user)),
      teams: teamsOf(doc),
      ...(group && { group: idOf(group), people: people.length }),
    });
    await notifyAssigned(doc, actor, peopleOf(doc).map((p) => p.user), createdKey(doc));
  }
  if (parent) {
    const made = results.filter((r) => r.created).map((r) => r.doc);
    if (note) {
      for (const doc of made) await staffTaskRepository.noteHistory(parent._id, subtaskEntry(actor, 'subtask_added', doc));
    }
    for (const { doc } of results) await noteSubtaskInInbox(parent, actor, doc);
    // Every time, even for a retry: it also finishes the count a failed first attempt left.
    await recountSubtasks(parent._id);
  }
  const tasks = results.map(({ doc }) => shape(doc, actor, { full: true }));
  return { task: tasks[0], tasks, duplicate: results.every((r) => !r.created) };
}

/**
 * Change a task. Only the fields present in `input` change; `rev` is required.
 *
 * `assigneeIds` sets everyone doing it (at least one); `assigneeId` gives it to
 * just that one person.
 *
 * @param {{ rev: number, title?, description?, priority?, dueOn?, startOn?, tags?, orderId?, status?, assigneeId?, assigneeIds?, archived? }} input
 */
export async function updateTask(actor, id, input = {}, req) {
  return applyUpdate(actor, await loadVisible(actor, id), input, req);
}

const sameIds = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The people on `t` once it is given to `ids`. Those already on it keep the name
 * and team they were given it with (and are not checked again — someone who has
 * since left the panel does not block taking a colleague off); only the new ones
 * are loaded and must be allowed, all or nothing.
 */
async function nextPeople(actor, t, ids) {
  if (!ids.length) throw fail('Keep at least one person on the task.', 400);
  if (ids.length > MAX_ASSIGNEES) throw fail(`Pick at most ${MAX_ASSIGNEES} people for one task.`, 400);
  if (ids.some((x) => !mongoose.isValidObjectId(x))) throw fail('Pick who should do this task.', 400);
  const now = peopleOf(t);
  const kept = new Map(now.map((p) => [idOf(p.user), {
    user: p.user,
    name: p.name || '',
    // A backfilled task has one person and keeps their team on the task itself.
    team: p.team !== undefined ? p.team : now.length === 1 ? teamsOf(t)[0] ?? null : null,
  }]));
  const fresh = ids.filter((x) => !kept.has(x));
  const loaded = fresh.length ? await loadAssignees(actor, fresh) : [];
  const byId = new Map(loaded.map((u) => [idOf(u._id), { user: u._id, name: u.name || '', team: teamOf(u) }]));
  return ids.map((x) => kept.get(x) ?? byId.get(x));
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
      if (!want && t.parent) await refuseOrphanRestore(t);
      set.archivedAt = want ? now : null;
      if (!want && t.archivedWithParent) set.archivedWithParent = null;
      note(want ? 'archived' : 'restored');
    } else if (canEdit(actor, t)) {
      // Already so: a retry of an archive or restore whose sub-tasks were not all moved finishes them.
      await moveSubtasksWith(actor, t, want, req);
    }
  }
  const willBeArchived = set.archivedAt !== undefined ? !!set.archivedAt : archived;
  const editing = ['title', 'description', 'priority', 'dueOn', 'dueTime', 'startOn', 'tags', 'orderId', 'status', 'assigneeId', 'assigneeIds', 'listId', 'estimateMinutes'].some(has);
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
  if (has('dueOn') || has('dueTime')) {
    const dueOn = has('dueOn') ? cleanDueOn(input.dueOn) : t.dueOn || null;
    // A new day keeps the time unless one is sent; no day means no time.
    let dueTime = has('dueTime') ? cleanDueTime(input.dueTime) : t.dueTime || null;
    if (!dueOn) {
      if (has('dueTime') && dueTime) throw fail('Pick a due date before a time.', 400);
      dueTime = null;
    }
    const was = dueKey(t.dueOn, t.dueTime);
    const next = dueKey(dueOn, dueTime);
    if (next !== was) {
      needEdit();
      if (dueOn !== (t.dueOn || null)) set.dueOn = dueOn;
      if (dueTime !== (t.dueTime || null)) set.dueTime = dueTime;
      note('due', was || 'none', next || 'none');
    }
  }
  if (has('startOn')) {
    const startOn = cleanStartOn(input.startOn);
    if (startOn !== (t.startOn || null)) { needEdit(); set.startOn = startOn; note('start', t.startOn || 'none', startOn || 'none'); }
  }
  if (set.dueOn !== undefined || set.startOn !== undefined) {
    checkDates(set.startOn !== undefined ? set.startOn : t.startOn, set.dueOn !== undefined ? set.dueOn : t.dueOn);
  }
  if (has('estimateMinutes')) {
    const estimate = cleanEstimate(input.estimateMinutes);
    if (estimate !== (t.estimateMinutes ?? null)) { needEdit(); set.estimateMinutes = estimate; note('estimate', t.estimateMinutes ?? 'none', estimate ?? 'none'); }
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
    const status = cleanEnum(input.status, TASK_PICKABLE_STATUSES, 'status');
    if (status !== shownStatus(t.status)) {
      if (!canSetStatus(actor, t)) throw fail('Only the person doing this task, whoever gave it, the team head or the admin can move it.', 403);
      set.status = status;
      set.completedAt = status === 'done' ? now : null;
      note('status', STATUS_LABELS[shownStatus(t.status)], STATUS_LABELS[status]);
    }
  }
  let added = [];
  const wanted = has('assigneeIds') ? input.assigneeIds : has('assigneeId') ? [input.assigneeId] : null;
  if (wanted) {
    if (!Array.isArray(wanted)) throw fail('Pick who should do this task.', 400);
    const before = peopleOf(t);
    const ids = [...new Set(wanted.map(idOf).filter(Boolean))];
    if (!sameIds(ids, before.map((p) => idOf(p.user)))) {
      if (t.personal) throw fail('A personal task stays with you. It can’t be given to anyone.', 400);
      if (!canReassign(actor, t)) throw fail('Only whoever gave this task, the team head or the admin can change who does it.', 403);
      const list = await nextPeople(actor, t, ids);
      Object.assign(set, personFields(list));
      note('assignee', namesOf(before), namesOf(list));
      added = list.filter((p) => !before.some((b) => same(b.user, p.user))).map((p) => p.user);
    }
  }
  // The list: a new one sent, or the old one dropped when the task left its team.
  const teamsNow = set.teams ?? teamsOf(t);
  if (has('listId') && t.personal) {
    if (input.listId) throw fail('A personal task can’t go in a team list.', 400);
  } else if (has('listId')) {
    const want = await listForTask(input.listId, teamsNow);
    if (idOf(want?._id) !== idOf(t.list)) {
      needEdit();
      const was = await liveList(t.list);
      set.list = want?._id ?? null;
      note('list', was?.name || '', want?.name || '');
    }
  } else if (t.list && set.teams) {
    const was = await liveList(t.list);
    if (!was || !teamsNow.includes(was.team)) { set.list = null; if (was) note('list', was.name, ''); }
  }

  if (!entries.length) return shape(t, actor, { full: true });
  // A retired 'waiting' becomes what it was already shown as, on its next change.
  if (t.status === 'waiting' && !set.status) set.status = 'in_progress';

  Object.assign(set, placeOf({
    status: set.status ?? t.status,
    dueOn: set.dueOn !== undefined ? set.dueOn : t.dueOn,
    dueTime: set.dueTime !== undefined ? set.dueTime : t.dueTime,
    completedAt: set.completedAt !== undefined ? set.completedAt : t.completedAt,
    archivedAt: set.archivedAt !== undefined ? set.archivedAt : t.archivedAt,
  }));

  const next = await staffTaskRepository.updateIfRev(t._id, rev, set, entries);
  if (!next) throw fail('Someone changed this task just now. It has been reloaded — check it and try again.', 409);

  // Sub-tasks follow their parent's archive; a parent's count follows its sub-tasks.
  if (set.archivedAt !== undefined) await moveSubtasksWith(actor, next, !!set.archivedAt, req);
  if (t.parent && next.bucket !== t.bucket) await recountSubtasks(t.parent.task);
  if (set.title !== undefined && !t.parent) await staffTaskRepository.renameParent(t._id, set.title);

  auditLogger.logAction(req, set.archivedAt ? 'DELETE' : 'UPDATE', 'StaffTask', t._id, {
    number: t.number, changes: entries.map((e) => e.action),
  });
  // Only now, after the write landed: a retried request is refused above (stale
  // rev) or changes nothing, so it never sends these twice.
  if (added.length) await notifyAssigned(next, actor, added);
  if (set.status !== undefined) await notifyStatus(next, actor, added);
  return shape(next, actor, { full: true });
}

/** A sub-task archived with (or apart from) its parent comes back only once the parent is back. */
async function refuseOrphanRestore(t) {
  const parent = await staffTaskRepository.findById(t.parent.task);
  if (parent?.bucket === 'archived') throw fail(`Restore T-${t.parent.number} first: this is one of its sub-tasks.`, 409);
}

/**
 * Archive `parent`'s sub-tasks with it, or bring back the ones archived with it.
 * Each is moved by one conditional write (from the bucket it was read in), so a
 * retry, or two of these at once, moves each sub-task once. Bounded by
 * SUBTASKS_MAX. Nothing for a task that is itself a sub-task.
 */
async function moveSubtasksWith(actor, parent, archiving, req) {
  if (parent.parent) return;
  const at = new Date();
  const children = archiving
    ? await staffTaskRepository.findChildrenToArchive(parent._id)
    : await staffTaskRepository.findChildrenToRestore(parent._id);
  if (!children.length) return;
  const entry = { at, by: actor._id, byName: actor.name || '', action: archiving ? 'archived' : 'restored', from: '', to: `with T-${parent.number}` };
  for (const c of children) {
    const set = archiving
      ? { archivedAt: at, archivedWithParent: true, ...placeOf({ ...c, archivedAt: at }) }
      : { archivedAt: null, archivedWithParent: null, ...placeOf({ ...c, archivedAt: null }) };
    await staffTaskRepository.moveWithParent(c._id, c.bucket, set, entry);
  }
  auditLogger.logAction(req, archiving ? 'DELETE' : 'UPDATE', 'StaffTask', parent._id, {
    number: parent.number, subtasks: children.map((c) => c.number), with: archiving ? 'archived' : 'restored',
  });
  await recountSubtasks(parent._id);
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
  return (!has('status') || input.status === shownStatus(t.status))
    && (!has('priority') || input.priority === t.priority)
    && (!has('dueOn') || input.dueOn === (t.dueOn || null))
    && (!has('assigneeId') || (peopleOf(t).length === 1 && same(input.assigneeId, peopleOf(t)[0].user)))
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
  if (c.status !== undefined) base.status = cleanEnum(c.status, TASK_PICKABLE_STATUSES, 'status');
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
        // A retried archive or restore still finishes moving the task's sub-tasks.
        if (input.archived !== undefined && canEdit(actor, t)) await moveSubtasksWith(actor, t, input.archived, req);
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

// ── Sub-tasks ───────────────────────────────────────────────────────────────

/**
 * The sub-tasks under a task (not archived), for its page. Whoever sees the
 * task sees them all listed; `canOpen` says which they may open, and the notes
 * of one they may not open are left out.
 *
 * @returns {Promise<{ subtasks: object[], total: number, done: number }>}
 */
export async function listSubtasks(actor, id) {
  const t = await loadVisible(actor, id);
  if (t.parent) return { subtasks: [], total: 0, done: 0 };
  const rows = await staffTaskRepository.findSubtasks(t._id, SUBTASKS_MAX);
  const today = todayIST();
  const subtasks = rows.map((r) => {
    const canOpen = canSee(actor, r);
    return { ...shape(r, actor, { today }), ...(!canOpen && { summary: '' }), canOpen };
  });
  return { subtasks, total: subtasks.length, done: subtasks.filter((r) => r.bucket === 'done').length };
}

/**
 * Turn a checklist step into a sub-task with the step's words as its title,
 * and take the step off. `clientId` is required: a retry finds the sub-task its
 * first attempt made (and takes the step off if that is still to do), so it is
 * never made twice.
 *
 * @returns {Promise<{ task: object, subtask: object }>} the parent as its page shows it, and the new sub-task
 */
export async function subtaskFromStep(actor, id, itemId, { clientId, assigneeIds } = {}, req) {
  const key = cleanClientId(clientId);
  if (!key) throw fail('Reload the task and try again.', 400);
  const t = await loadVisible(actor, id);
  const item = mongoose.isValidObjectId(itemId) && (t.checklist || []).find((c) => same(c._id, itemId));
  if (!item) {
    // Gone because a first attempt already did it: answer as that attempt did.
    const made = await staffTaskRepository.findByClientId(actor._id, key);
    if (made && same(made.parent?.task, t._id)) return { task: await getTask(actor, id), subtask: shape(made, actor, { full: true }) };
    throw fail('That step is no longer on the checklist.', 404);
  }
  const { task: subtask } = await createTask(actor, {
    title: item.text, parentId: id, clientId: key, shared: true,
    ...(Array.isArray(assigneeIds) && assigneeIds.length ? { assigneeIds } : {}),
  }, req, { note: false });
  await staffTaskRepository.pullChecklistItem(t._id, item._id, {
    at: new Date(), by: actor._id, byName: actor.name || '', action: 'check_to_subtask', from: item.text, to: subtask.code,
  });
  return { task: await getTask(actor, id), subtask };
}

// ── Followers ───────────────────────────────────────────────────────────────
/*
  A follower sees the task, comments and hears about it, but does not do it:
  they cannot move it or tick its steps. Anyone who sees a task may follow it or
  stop following it themselves; choosing for anyone else is editing it (whoever
  gave it, the heads on it, the admin). None of it bumps `rev`, so following
  never makes someone's open edit stale, and each change is one atomic write.
*/

const EDIT_FOLLOWERS = 'Only whoever gave this task, the team head or the admin can choose who follows it.';
const FOLLOWERS_FULL = `A task can have at most ${FOLLOWERS_MAX} followers.`;
const asUser = (x) => ({ _id: x });

/** People in the panel, loaded and allowed, all or nothing — as `{ user, name }`. */
async function loadFollowers(actor, ids) {
  if (!ids.length) return [];
  const found = await userRepository.findChatUsersByIds(ids);
  const byId = new Map(found.map((u) => [idOf(u._id), u]));
  const people = ids.map((x) => byId.get(x));
  if (people.some((u) => !u)) throw fail('Someone you picked is no longer in the staff panel.', 400);
  if (people.some((u) => !mayAssignTo(actor, u))) throw fail('Only people in the staff panel can follow a task.', 403);
  return people.map((u) => ({ user: u._id, name: u.name || '' }));
}

/** Put `people` ({ user, name }) on `t` as followers and take `removeIds` off. Returns the task, or throws. */
async function writeFollowers(actor, t, people, removeIds) {
  const entries = [
    ...people.map((p) => checkEntry(actor, 'follower_added', p.name)),
    ...followersOf(t).filter((p) => removeIds.includes(idOf(p.user))).map((p) => ({ ...checkEntry(actor, 'follower_removed', ''), from: p.name || '' })),
  ];
  const next = await staffTaskRepository.changeFollowers(
    t._id, { addPeople: people, removeIds: removeIds.map((x) => new mongoose.Types.ObjectId(x)) }, entries, FOLLOWERS_MAX,
  );
  if (next) return next;
  if (!(await staffTaskRepository.findById(t._id))) throw fail('Task not found.', 404);
  throw fail(FOLLOWERS_FULL, 400);
}

/**
 * Add and remove followers (person ids). Adding someone already following, or
 * someone doing the task, changes nothing; so does removing someone who is not
 * following — a retried request is a success, not an error.
 *
 * @returns {Promise<{ task: object|null }>} null when the actor stopped following
 *   a task they can no longer see.
 */
export async function changeFollowers(actor, id, { add = [], remove = [] } = {}) {
  const t = await loadVisible(actor, id);
  const clean = (list) => {
    if (list == null) return [];
    if (!Array.isArray(list) || list.some((x) => !mongoose.isValidObjectId(x))) throw fail('Invalid person.', 400);
    return [...new Set(list.map(String))];
  };
  const addIds = clean(add);
  const removeIds = clean(remove);
  if (addIds.some((x) => removeIds.includes(x))) throw fail('Add or remove a person, not both.', 400);
  if (t.personal && addIds.length) throw fail('A personal task is only yours, so nobody can follow it.', 400);
  if (![...addIds, ...removeIds].every((x) => same(x, actor._id)) && !canEdit(actor, t)) throw fail(EDIT_FOLLOWERS, 403);

  const toAdd = addIds.filter((x) => !isDoing(asUser(x), t) && !isFollowing(asUser(x), t));
  const toRemove = removeIds.filter((x) => isFollowing(asUser(x), t));
  if (!toAdd.length && !toRemove.length) return { task: await getTask(actor, id) };
  if (toAdd.length && t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (followersOf(t).length - toRemove.length + toAdd.length > FOLLOWERS_MAX) throw fail(FOLLOWERS_FULL, 400);

  const next = await writeFollowers(actor, t, await loadFollowers(actor, toAdd), toRemove);
  return { task: canSee(actor, next) ? { ...shape(next, actor, { full: true }), siblings: await siblingsOf(actor, next) } : null };
}

// ── Comments ────────────────────────────────────────────────────────────────
/*
  Everyone who sees a task may comment, @mention, react and attach files.
  The author may edit or delete their own comment for COMMENT_EDIT_WINDOW_MS
  (the same 30 minutes as team chat); nobody may change anyone else's — not the
  giver, not a head, not the admin. Both are SOFT: the earlier words stay in the
  database, and what people see is "edited" or "This comment was deleted."

  Mentions: anyone on the task. Whoever gave it, a head on it or the admin may
  also @mention someone in the panel who is not on it — that person becomes a
  follower first, so they can open what they were called to.

  Pop-ups: a new comment goes to the people doing it, its followers and whoever
  gave it; anyone @mentioned gets "mentioned you" instead. Never to the writer,
  never twice for a retried post, never for a reaction or an edit.
*/

const peopleOnTask = async (t) => {
  const teams = teamsOf(t).filter(Boolean);
  const staffOf = await Promise.all([...new Set(teams)].map((team) => userRepository.findActiveStaff(team)));
  const heads = staffOf.flat().filter((u) => u.staff?.isHead);
  const direct = await userRepository.findChatUsersByIds(audienceOf(t).filter(Boolean));
  const byId = new Map([...direct, ...heads].map((u) => [idOf(u._id), u]));
  return [...byId.values()];
};

/**
 * Who `actor` may @mention on this task, apart from themselves: the people on
 * it, and — for those who may add followers — everyone else in the panel too,
 * marked `onTask: false` (mentioning them makes them a follower).
 */
export async function listMentionable(actor, id) {
  const t = await loadVisible(actor, id);
  if (t.personal) return { people: [] };
  const on = await peopleOnTask(t);
  const onIds = new Set(on.map((u) => idOf(u._id)));
  const everyone = canEdit(actor, t) && t.bucket !== 'archived'
    ? (await userRepository.findChatUsers()).filter((u) => mayAssignTo(actor, u))
    : [];
  const byId = new Map([...on, ...everyone].map((u) => [idOf(u._id), u]));
  const people = [...byId.values()]
    .filter((u) => !same(u._id, actor._id))
    .map((u) => ({ id: idOf(u._id), name: u.name || '', onTask: onIds.has(idOf(u._id)) }))
    // The people on the task first, then everyone else — each by name.
    .sort((a, b) => Number(b.onTask) - Number(a.onTask) || a.name.localeCompare(b.name));
  return { people };
}

/**
 * Mentions as sent (a list, or a JSON list from a form with files). Each must be
 * on the task — or, for whoever may add followers, in the panel: those come back
 * in `newFollowers` ({ user, name }) to be added before the comment is saved.
 * @returns {Promise<{ ids: mongoose.Types.ObjectId[], newFollowers: object[] }>}
 */
async function cleanMentions(actor, t, raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = raw ? JSON.parse(raw) : []; } catch { throw fail('Invalid mentions.', 400); }
  }
  if (list == null) return { ids: [], newFollowers: [] };
  if (!Array.isArray(list) || list.some((x) => !mongoose.isValidObjectId(x))) throw fail('Invalid mentions.', 400);
  const ids = [...new Set(list.map(String))].filter((x) => !same(x, actor._id));
  if (!ids.length) return { ids: [], newFollowers: [] };
  if (t.personal) throw fail('A personal task is only yours, so nobody can be mentioned on it.', 400);
  if (ids.length > MENTIONS_MAX) throw fail(`Mention at most ${MENTIONS_MAX} people in one comment.`, 400);
  const on = new Set((await peopleOnTask(t)).map((u) => idOf(u._id)));
  const outside = ids.filter((x) => !on.has(x));
  if (outside.length && !canEdit(actor, t)) throw fail('You can only mention people on this task.', 400);
  if (followersOf(t).length + outside.length > FOLLOWERS_MAX) throw fail(FOLLOWERS_FULL, 400);
  const newFollowers = await loadFollowers(actor, outside);
  return { ids: ids.map((x) => new mongoose.Types.ObjectId(x)), newFollowers };
}

const saidIn = (c) => (c.text ? richTextToPlain(c.text).replace(/\s+/g, ' ').slice(0, 120) : 'Shared a file');

/** Inbox lines for a comment: "mentioned you" to those named, "commented" to the rest. */
async function commentToInbox(t, actor, c) {
  const mentioned = (c.mentions || []).map(idOf);
  const key = `c:${idOf(c._id)}`;
  await toInboxAll(t, actor, [
    { ids: mentioned, kind: 'mention', key, text: saidIn(c) },
    { ids: audienceOf(t).filter((x) => !mentioned.includes(idOf(x))), kind: 'comment', key, text: saidIn(c) },
  ]);
}

/** The Inbox lines and pop-ups for a new comment. Best effort; never throws. */
async function notifyComment(t, actor, c) {
  await commentToInbox(t, actor, c);
  try {
    const mentioned = (c.mentions || []).map(idOf);
    const who = actor.name || 'Someone';
    const body = `T-${t.number} · ${t.title}: ${saidIn(c)}`;
    await notifyPeople(t, actor, mentioned, { title: `${who} mentioned you`, body });
    await notifyPeople(t, actor, audienceOf(t).filter((x) => !mentioned.includes(idOf(x))), { title: `${who} commented on T-${t.number}`, body });
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
    comments: comments.map((c) => shapeComment({ ...c, viewerEdits: canEdit(actor, t) }, actor, names, now)),
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
    // A retry: finish the Inbox lines a failed first attempt may have missed (keyed, so none double).
    if (seen) { await commentToInbox(t, actor, seen); return { comment: await shapeOne(seen, actor), duplicate: true }; }
  }
  const body = cleanCommentText(text);
  if (!body && !files.length) throw fail('Write a comment first.', 400);
  if (files.length > COMMENT_FILES_MAX) throw fail(`Attach at most ${COMMENT_FILES_MAX} files to one comment.`, 400);
  const { ids: mentionIds, newFollowers } = await cleanMentions(actor, t, mentions);
  // Someone @mentioned from outside follows first, so the comment never names a
  // person who cannot open it. Adding a follower twice changes nothing, so a
  // retry that gets this far is safe too.
  if (newFollowers.length) await writeFollowers(actor, t, newFollowers, []);
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
      if (seen) { await commentToInbox(t, actor, seen); return { comment: await shapeOne(seen, actor), duplicate: true }; }
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
  const body = cleanCommentText(text);
  if (!body && !(c.attachments || []).length) throw fail('A comment needs some words — delete it instead.', 400);
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

// ── Assigned comments ───────────────────────────────────────
/*
  Anyone who can comment may give an unassigned comment to someone on the task.
  After that, only the person it was given to, whoever gave it, whoever wrote it
  or an editor of the task changes it. Both writes say what it should BE, so a
  double-click or retry changes nothing and tells nobody twice.
*/
const ASSIGNED_PAGE_SIZE = 30;
const SAID_MAX = 300;

const mayChangeAssignment = (actor, t, c) => canEdit(actor, t)
  || [c.assignedTo, c.assignedBy, c.by].some((u) => same(u, actor._id));

const shapeForViewer = async (t, c, actor) => shapeOne({ ...c, viewerEdits: canEdit(actor, t) }, actor);

export async function assignComment(actor, id, commentId, userId) {
  const { t, c } = await loadComment(actor, id, commentId);
  if (c.deletedAt) throw fail('This comment was deleted.', 409);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (c.assignedTo && !mayChangeAssignment(actor, t, c)) throw fail('Only the people involved can change who this comment is assigned to.', 403);

  if (userId === null) {
    const cleared = await staffTaskRepository.unassignComment(c._id);
    if (cleared) {
      await staffTaskRepository.noteHistory(t._id, { at: new Date(), by: actor._id, byName: actor.name || '', action: 'comment_unassigned', from: '', to: '' });
    }
    return { comment: await shapeForViewer(t, cleared || await staffTaskRepository.findComment(t._id, c._id), actor) };
  }

  // The same rule as @mentioning: someone outside the task follows it first, so they can open it.
  if (!same(userId, actor._id)) {
    const { newFollowers } = await cleanMentions(actor, t, [userId]);
    if (newFollowers.length) await writeFollowers(actor, t, newFollowers, []);
  }
  const user = new mongoose.Types.ObjectId(String(userId));
  const updated = await staffTaskRepository.assignComment(c._id, user, actor._id);
  if (!updated) {
    const now = await staffTaskRepository.findComment(t._id, c._id);
    if (now?.deletedAt) throw fail('This comment was deleted.', 409);
    return { comment: await shapeForViewer(t, now, actor) }; // already theirs
  }
  const out = await shapeForViewer(t, updated, actor);
  await staffTaskRepository.noteHistory(t._id, { at: new Date(), by: actor._id, byName: actor.name || '', action: 'comment_assigned', from: '', to: out.assignment.to.name });
  await toInbox(t, actor, [user], { kind: 'comment_assigned', key: `c:${idOf(c._id)}:as:${idOf(user)}:${new Date(updated.assignedAt).getTime()}`, text: saidIn(c) });
  void notifyPeople(t, actor, [user], { title: `${actor.name || 'Someone'} assigned you a comment on T-${t.number}`, body: t.title });
  return { comment: out };
}

export async function resolveComment(actor, id, commentId, resolved) {
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(commentId)) throw fail('Comment not found.', 404);
  const t = await staffTaskRepository.findById(id);
  const c = await staffTaskRepository.findComment(id, commentId);
  // Someone who has since lost the task can still clear it off their own list, and learns nothing more.
  const visible = !!t && canSee(actor, t);
  if (!c || (!visible && !same(c.assignedTo, actor._id))) throw fail('Comment not found.', 404);
  if (c.deletedAt) throw fail('This comment was deleted.', 409);
  if (!c.assignedTo) throw fail('Nobody is assigned this comment.', 409);
  if (visible && !mayChangeAssignment(actor, t, c)) throw fail('Only the people involved can resolve this comment.', 403);

  const on = resolved === true || resolved === 'true';
  const updated = await staffTaskRepository.setCommentResolved(c._id, on, actor._id);
  if (updated && t) {
    await staffTaskRepository.noteHistory(t._id, { at: new Date(), by: actor._id, byName: actor.name || '', action: on ? 'comment_resolved' : 'comment_reopened', from: '', to: '' });
    if (on && visible) {
      await toInbox(t, actor, [c.assignedBy, c.by].filter(Boolean), { kind: 'comment_resolved', key: `c:${idOf(c._id)}:res:${new Date(updated.resolvedAt).getTime()}`, text: saidIn(c) });
    }
  }
  if (!visible) return { comment: null };
  return { comment: await shapeForViewer(t, updated || await staffTaskRepository.findComment(t._id, c._id), actor) };
}

/** The comments given to `actor`, newest first. One they can no longer open keeps a line, without its words. */
export async function listAssignedComments(actor, { state = 'open', before } = {}) {
  const resolved = state === 'resolved';
  const rows = await staffTaskRepository.pageAssignedComments(actor._id, { resolved, before: before || null, limit: ASSIGNED_PAGE_SIZE + 1 });
  const more = rows.length > ASSIGNED_PAGE_SIZE;
  const page = more ? rows.slice(0, ASSIGNED_PAGE_SIZE) : rows;
  const [tasks, people] = await Promise.all([
    staffTaskRepository.tasksForComments([...new Set(page.map((c) => idOf(c.task)))]),
    userRepository.findDisplayByIds([...new Set(page.map((c) => idOf(c.assignedBy)).filter(Boolean))]),
  ]);
  const taskOf = new Map(tasks.map((t) => [idOf(t._id), t]));
  const nameOf = new Map(people.map((u) => [idOf(u._id), u.name || '']));
  const comments = page.map((c) => {
    const t = taskOf.get(idOf(c.task));
    const canOpen = !!t && canSee(actor, t);
    return {
      id: idOf(c._id),
      task: canOpen ? { id: idOf(t._id), code: `T-${t.number}`, title: t.title } : { id: idOf(c.task), code: '', title: '' },
      canOpen,
      text: canOpen ? richTextToPlain(c.text || '').slice(0, SAID_MAX) : '',
      by: canOpen ? { id: idOf(c.by), name: c.byName || '' } : null,
      assignedBy: canOpen ? nameOf.get(idOf(c.assignedBy)) || '' : '',
      at: c.assignedAt,
      resolvedAt: c.resolvedAt || null,
    };
  });
  return { comments, nextBefore: more ? idOf(page[page.length - 1]._id) : null };
}

// ── Team overview ───────────────────────────────────────────
const OVERVIEW_SCAN_MAX = 5000;
const OVERVIEW_ROWS = 5;
const OVERVIEW_PEOPLE = 12;

const overviewRow = (t) => ({ id: idOf(t._id), code: `T-${t.number}`, title: t.title, dueOn: t.dueOn || null, dueTime: t.dueTime || '', completedAt: t.completedAt || null });

/** One team's numbers: everyone in the team sees them; an admin picks the team. Personal tasks never count. */
export async function teamOverview(actor, { team } = {}) {
  let chosen;
  if (isAdmin(actor)) {
    if (!team) throw fail('Pick a team first.', 400);
    chosen = team === 'admin' ? null : team;
  } else {
    if (!teamOf(actor)) throw fail('Only people in a team see the team\'s tasks.', 403);
    if (team && team !== teamOf(actor)) throw fail('You can only see your own team.', 403);
    chosen = teamOf(actor);
  }
  const query = { teams: chosen, personal: { $ne: true } };
  const today = todayIST();
  const lateTodayUpTo = `${today} ${timeIST()}`;
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 8);
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const [open, doneWeek, recentDone] = await Promise.all([
    staffTaskRepository.overviewScan(query, OVERVIEW_SCAN_MAX + 1),
    staffTaskRepository.countUpTo({ ...query, bucket: 'done', rank: { $lte: `d${String(TIME_MAX - since).padStart(13, '0')}` } }, OVERVIEW_SCAN_MAX),
    staffTaskRepository.overviewDone(query, OVERVIEW_ROWS),
  ]);
  const capped = open.length > OVERVIEW_SCAN_MAX;
  const rows = capped ? open.slice(0, OVERVIEW_SCAN_MAX) : open;

  const counts = { open: rows.length, late: 0, today: 0, nextWeek: 0, noDate: 0, unassigned: 0, doneWeek: doneWeek.count };
  const byStatus = {};
  const byPerson = new Map();
  const late = [];
  for (const t of rows) {
    const r = t.rank;
    const isLate = r < today || (r > today && r <= lateTodayUpTo);
    if (isLate) { counts.late += 1; if (late.length < OVERVIEW_ROWS) late.push(overviewRow(t)); }
    else if (r === NO_DUE) counts.noDate += 1;
    else if (r < tomorrow) counts.today += 1;
    else if (r < weekEnd) counts.nextWeek += 1;
    const status = shownStatus(t.status);
    byStatus[status] = (byStatus[status] || 0) + 1;
    const doing = peopleOf(t);
    if (!doing.length) counts.unassigned += 1;
    for (const p of doing) {
      const row = byPerson.get(idOf(p.user)) || { id: idOf(p.user), name: p.name || '', open: 0, late: 0 };
      row.open += 1;
      if (isLate) row.late += 1;
      byPerson.set(row.id, row);
    }
  }
  const people = [...byPerson.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return {
    team: team || teamOf(actor),
    counts,
    capped: capped || doneWeek.capped,
    byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, label: STATUS_LABELS[status] || status, count })),
    people: people.slice(0, OVERVIEW_PEOPLE),
    morePeople: Math.max(0, people.length - OVERVIEW_PEOPLE),
    late,
    recentDone: recentDone.map(overviewRow),
  };
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
  const own = (t.files || []).find((f) => f.publicId === publicId)
    || await staffTaskRepository.liveCommentFile(t._id, publicId);
  if (!own) throw fail('File not found.', 404);
  const file = await readTaskFile(idOf(t._id), name);
  // The name it was uploaded with, for a download's file name.
  return { ...file, name: own.name || null };
}
