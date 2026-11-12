/**
 * Projects in the staff Tasks module (models/StaffProject.js).
 *
 * ── Who does what ───────────────────────────────────────────────────────────
 *   create   the admin and team heads
 *   see      the admin; the owner and members; the head of any member's team
 *   change   the admin and the owner (name, notes, dates, people, status, delete)
 *   tasks    whoever sees a project may read and comment on every task in it
 *            (services/staffTaskService.js canSee). Changing a task still
 *            follows the task's own rules: being in a project grants no edits.
 *   filing   a task goes into a project only from someone who may edit the
 *            task AND sees the project — otherwise anyone could push their
 *            task in front of a project's people, or a project's tasks out of it
 *
 * ── Why counts never reveal hidden tasks ────────────────────────────────────
 * The progress numbers count the project's open and done tasks. Everyone who
 * sees a project may open every one of those tasks, and a personal task can
 * never join a project (and is excluded from the count anyway), so no number
 * on a project card stands for a task its viewer cannot open.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - a double-clicked "Create" makes one project (clientId, unique per author)
 *   - two people editing at once never silently overwrite each other (rev)
 *   - nothing is deleted: "delete" archives; the tasks keep their link
 *   - lists are keyset-paged and bounded; counts are one aggregate per page
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffProjectRepository, { PROJECT_STATUSES, PROJECT_COLOURS } from '../repositories/staffProjectRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { formatIsoDateIST } from '../utils/datetime.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const PROJECT_PAGE_SIZE = 20;
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const PROJECT_PEOPLE_MAX = 50;
/** Projects one person's access is read from, per request. Far above any real use. */
export const PROJECT_ACCESS_CAP = 500;
/** Projects offered in a task's "Project" picker. */
export const PROJECT_PICK_MAX = 200;
/** "At risk" when the deadline is this close and less than AT_RISK_PERCENT is done. */
export const AT_RISK_DAYS = 7;
export const AT_RISK_PERCENT = 80;
const NO_DUE = '9999-12-31';

export const PROJECT_STATUS_LABELS = Object.freeze({
  on_track: 'On track', at_risk: 'At risk', late: 'Late', done: 'Done',
});

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const same = (a, b) => !!a && !!b && idOf(a) === idOf(b);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isHead = (u) => isActiveStaff(u) && u.staff.isHead === true;
const teamOf = (u) => (isActiveStaff(u) ? u.staff.team : null);
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);
const todayIST = (now = new Date()) => formatIsoDateIST(now);
const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// ── Rules ───────────────────────────────────────────────────────────────────

export const canCreateProject = (u) => isAdmin(u) || isHead(u);
const isInProject = (u, p) => (p.people || []).some((x) => same(x.user, u?._id));
const headOfProjectTeam = (u, p) => isHead(u) && (p.teams || []).includes(teamOf(u));
export const seesProject = (u, p) => !!p && !p.archivedAt && (isAdmin(u) || isInProject(u, p) || headOfProjectTeam(u, p));
/** An archived project is still the admin's and its owner's to restore. */
const seesArchived = (u, p) => !!p && (isAdmin(u) || same(p.owner?.user, u?._id));
export const canManageProject = (u, p) => !!p && (isAdmin(u) || same(p.owner?.user, u?._id));

/** The projects `actor` may see, as a query (the same rule as seesProject). */
function visibleQuery(actor) {
  if (isAdmin(actor)) return {};
  const or = [{ 'people.user': actor._id }];
  if (isHead(actor)) or.push({ teams: teamOf(actor) });
  return { $or: or };
}

/*
  Which projects a person may see, read once per request and kept beside the
  user object (a WeakMap: it goes when the request's user does). canSee in the
  task service reads it, so every place a task is opened — its page, comments,
  files, timer, links — answers the same way without a query of its own.
  Not loaded means no project access: a caller that forgets fails closed.
*/
const access = new WeakMap();

export async function loadProjectAccess(actor) {
  if (!actor || access.has(actor)) return access.get(actor) ?? new Set();
  // The admin sees every task already; nothing to read.
  const ids = !inPanel(actor) || isAdmin(actor) ? [] : await staffProjectRepository.findIds(visibleQuery(actor), PROJECT_ACCESS_CAP);
  const set = new Set(ids.map(idOf));
  access.set(actor, set);
  return set;
}

/** Does `actor` see the project with this id? From the access read above. */
export const inProjectAccess = (actor, projectId) => !!projectId && !!actor && (access.get(actor)?.has(idOf(projectId)) ?? false);

// ── Input ───────────────────────────────────────────────────────────────────

function cleanName(raw) {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) throw fail('Give the project a name.', 400);
  if (name.length > PROJECT_NAME_MAX) throw fail(`Keep the name under ${PROJECT_NAME_MAX} characters.`, 400);
  return name;
}
function cleanDescription(raw) {
  // eslint-disable-next-line no-control-regex
  const text = String(raw ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (text.length > PROJECT_DESCRIPTION_MAX) throw fail(`Keep the description under ${PROJECT_DESCRIPTION_MAX} characters.`, 400);
  return text;
}
function cleanColour(raw) {
  if (raw == null || raw === '') return 'blue';
  if (!PROJECT_COLOURS.includes(raw)) throw fail('Pick one of the colours.', 400);
  return raw;
}
function cleanDay(raw, what) {
  if (raw == null || raw === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) {
    throw fail(`Pick a valid ${what} date.`, 400);
  }
  return m[0];
}
function checkDates(startOn, dueOn) {
  if (startOn && dueOn && startOn > dueOn) throw fail('The start date can’t be after the deadline.', 400);
}
function cleanStatusOverride(raw) {
  if (raw == null || raw === '' || raw === 'auto') return null;
  if (!PROJECT_STATUSES.includes(raw)) throw fail('Pick a valid status.', 400);
  return raw;
}
const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

/** The owner and members, loaded and checked: all in the panel, or nothing is saved. */
async function loadPeople(ownerId, memberIds) {
  if (!mongoose.isValidObjectId(ownerId)) throw fail('Pick who owns this project.', 400);
  if (memberIds != null && !Array.isArray(memberIds)) throw fail('Members must be a list.', 400);
  const ids = [...new Set([String(ownerId), ...(memberIds || []).map(String).filter(Boolean)])];
  if (ids.length > PROJECT_PEOPLE_MAX) throw fail(`A project can have at most ${PROJECT_PEOPLE_MAX} people.`, 400);
  if (ids.some((x) => !mongoose.isValidObjectId(x))) throw fail('Pick people from the list.', 400);
  const found = await userRepository.findChatUsersByIds(ids);
  const byId = new Map(found.map((u) => [idOf(u._id), u]));
  const people = ids.map((x) => byId.get(x));
  if (people.some((u) => !u || !inPanel(u))) throw fail('Someone you picked is no longer in the staff panel.', 400);
  const list = people.map((u) => ({ user: u._id, name: u.name || '', team: teamOf(u) }));
  return { owner: list[0], people: list, teams: [...new Set(list.map((p) => p.team).filter(Boolean))] };
}

// ── Shape ───────────────────────────────────────────────────────────────────

const NO_COUNTS = Object.freeze({ total: 0, done: 0, overdue: 0 });

/** How a project stands: the owner's word if they set one, else from its tasks and deadline. */
export function statusOf(p, counts = NO_COUNTS, today = todayIST()) {
  if (p.statusOverride) return p.statusOverride;
  const open = counts.total - counts.done;
  if (counts.total > 0 && open === 0) return 'done';
  if (p.dueOn && p.dueOn < today && open > 0) return 'late';
  if (counts.overdue > 0) return 'at_risk';
  const percent = counts.total ? (counts.done * 100) / counts.total : 0;
  if (p.dueOn && open > 0 && p.dueOn <= addDays(today, AT_RISK_DAYS) && percent < AT_RISK_PERCENT) return 'at_risk';
  return 'on_track';
}

function shape(p, viewer, counts = NO_COUNTS, today = todayIST()) {
  const status = statusOf(p, counts, today);
  const archived = !!p.archivedAt;
  return {
    id: idOf(p._id),
    name: p.name,
    description: p.description || '',
    colour: p.colour || 'blue',
    owner: { id: idOf(p.owner?.user), name: p.owner?.name || '' },
    people: (p.people || []).map((x) => ({ id: idOf(x.user), name: x.name || '', team: x.team || null })),
    teams: (p.teams || []).map((t) => ({ value: t, label: STAFF_TEAM_LABELS[t] || t })),
    startOn: p.startOn || null,
    dueOn: p.dueOn || null,
    status,
    statusLabel: PROJECT_STATUS_LABELS[status],
    statusOverride: p.statusOverride || null,
    progress: {
      total: counts.total,
      done: counts.done,
      overdue: counts.overdue,
      percent: counts.total ? Math.round((counts.done * 100) / counts.total) : 0,
    },
    archivedAt: p.archivedAt || null,
    createdBy: { id: idOf(p.createdBy), name: p.createdByName || '' },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    rev: p.rev,
    can: {
      edit: !archived && canManageProject(viewer, p),
      archive: !archived && canManageProject(viewer, p),
      restore: archived && canManageProject(viewer, p),
    },
  };
}

/** Counts for every project on a page, from one aggregate. */
async function countsFor(projects, today) {
  const rows = await staffProjectRepository.taskCounts(projects.map((p) => p._id), today);
  return new Map(rows.map((r) => [idOf(r._id), { total: r.total, done: r.done, overdue: r.overdue }]));
}

// ── Read ────────────────────────────────────────────────────────────────────

/** A project `actor` may see (or, archived, restore) — else it does not exist for them. */
export async function loadVisibleProject(actor, id, { archived = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw fail('Project not found.', 404);
  const p = await staffProjectRepository.findById(id);
  if (!p || !(seesProject(actor, p) || (archived && p.archivedAt && seesArchived(actor, p)))) throw fail('Project not found.', 404);
  return p;
}

const encodeCursor = (p) => Buffer.from(JSON.stringify({ r: p.rank, i: idOf(p._id) })).toString('base64url');
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
 * One page of the projects `actor` sees, soonest deadline first (none last).
 * `state: 'archived'` is the admin's and owners' deleted ones, to restore.
 */
export async function listProjects(actor, { state = 'active', cursor } = {}) {
  if (!inPanel(actor)) throw fail('Project not found.', 404);
  let query;
  if (state === 'archived') {
    query = { archivedAt: { $type: 'date' }, ...(isAdmin(actor) ? {} : { 'owner.user': actor._id }) };
  } else {
    query = { archivedAt: null, ...visibleQuery(actor) };
  }
  const rows = await staffProjectRepository.page(query, { after: decodeCursor(cursor), limit: PROJECT_PAGE_SIZE + 1 });
  const more = rows.length > PROJECT_PAGE_SIZE;
  const page = more ? rows.slice(0, PROJECT_PAGE_SIZE) : rows;
  const today = todayIST();
  const counts = await countsFor(page, today);
  return {
    projects: page.map((p) => shape(p, actor, counts.get(idOf(p._id)), today)),
    nextCursor: more ? encodeCursor(page[page.length - 1]) : null,
    canCreate: canCreateProject(actor),
  };
}

/** Names only, for a task's "Project" picker: the live projects `actor` sees. */
export async function pickableProjects(actor) {
  if (!inPanel(actor)) return { projects: [] };
  const rows = await staffProjectRepository.page({ archivedAt: null, ...visibleQuery(actor) }, { limit: PROJECT_PICK_MAX });
  return { projects: rows.map((p) => ({ id: idOf(p._id), name: p.name, colour: p.colour || 'blue' })) };
}

export async function getProject(actor, id) {
  const p = await loadVisibleProject(actor, id, { archived: true });
  const today = todayIST();
  const counts = await countsFor([p], today);
  return shape(p, actor, counts.get(idOf(p._id)), today);
}

// ── Write ───────────────────────────────────────────────────────────────────

export async function createProject(actor, input = {}, req) {
  if (!canCreateProject(actor)) throw fail('Only the admin and team heads can start a project.', 403);
  const clientId = cleanClientId(input.clientId);
  if (clientId) {
    const seen = await staffProjectRepository.findByClientId(actor._id, clientId);
    if (seen) return { project: await getProject(actor, seen._id), duplicate: true };
  }
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const colour = cleanColour(input.colour);
  const startOn = cleanDay(input.startOn, 'start');
  const dueOn = cleanDay(input.dueOn, 'deadline');
  checkDates(startOn, dueOn);
  // A head who names no owner owns it; the admin may hand it to anyone.
  const { owner, people, teams } = await loadPeople(input.ownerId || actor._id, input.memberIds);
  let doc;
  try {
    doc = await staffProjectRepository.create({
      name, description, colour, owner, people, teams, startOn, dueOn,
      rank: dueOn || NO_DUE,
      statusOverride: null,
      createdBy: actor._id,
      createdByName: actor.name || '',
      clientId,
    });
  } catch (err) {
    // The same create twice at the same moment: the unique clientId index decided.
    if (err?.code === 11000 && clientId) {
      const seen = await staffProjectRepository.findByClientId(actor._id, clientId);
      if (seen) return { project: await getProject(actor, seen._id), duplicate: true };
    }
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'StaffProject', doc._id, { name, people: people.length, teams });
  return { project: shape(doc, actor), duplicate: false };
}

/** Change a project. Only the fields present change; `rev` is required. */
export async function updateProject(actor, id, input = {}, req) {
  const p = await loadVisibleProject(actor, id, { archived: true });
  if (!canManageProject(actor, p)) throw fail('Only the project owner or the admin can change this project.', 403);
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload and try again.', 400);
  if (rev !== p.rev) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const set = {};

  if (has('archived')) {
    const want = input.archived === true || input.archived === 'true';
    if (want !== !!p.archivedAt) set.archivedAt = want ? new Date() : null;
  }
  const archivedAfter = set.archivedAt !== undefined ? !!set.archivedAt : !!p.archivedAt;
  const editing = ['name', 'description', 'colour', 'startOn', 'dueOn', 'ownerId', 'memberIds', 'statusOverride'].some(has);
  if (editing && archivedAfter) throw fail('This project is deleted. Restore it first.', 409);

  if (has('name')) { const name = cleanName(input.name); if (name !== p.name) set.name = name; }
  if (has('description')) { const d = cleanDescription(input.description); if (d !== (p.description || '')) set.description = d; }
  if (has('colour')) { const c = cleanColour(input.colour); if (c !== p.colour) set.colour = c; }
  const startOn = has('startOn') ? cleanDay(input.startOn, 'start') : p.startOn || null;
  const dueOn = has('dueOn') ? cleanDay(input.dueOn, 'deadline') : p.dueOn || null;
  if (has('startOn') || has('dueOn')) {
    checkDates(startOn, dueOn);
    if (startOn !== (p.startOn || null)) set.startOn = startOn;
    if (dueOn !== (p.dueOn || null)) { set.dueOn = dueOn; set.rank = dueOn || NO_DUE; }
  }
  if (has('statusOverride')) {
    const s = cleanStatusOverride(input.statusOverride);
    if (s !== (p.statusOverride || null)) set.statusOverride = s;
  }
  if (has('ownerId') || has('memberIds')) {
    const ownerId = has('ownerId') ? input.ownerId : idOf(p.owner.user);
    const memberIds = has('memberIds') ? input.memberIds : (p.people || []).map((x) => idOf(x.user));
    // Only the admin hands a project to someone else; an owner may not give it away and lose it.
    if (!same(ownerId, p.owner.user) && !isAdmin(actor)) throw fail('Only the admin can change who owns a project.', 403);
    const next = await loadPeople(ownerId, memberIds);
    const before = (p.people || []).map((x) => idOf(x.user)).join(',');
    if (next.people.map((x) => idOf(x.user)).join(',') !== before || !same(next.owner.user, p.owner.user)) {
      Object.assign(set, next);
    }
  }

  if (!Object.keys(set).length) return getProject(actor, p._id);
  const next = await staffProjectRepository.updateIfRev(p._id, rev, set);
  if (!next) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);
  auditLogger.logAction(req, set.archivedAt ? 'DELETE' : 'UPDATE', 'StaffProject', p._id, { changes: Object.keys(set) });
  return getProject(actor, next._id);
}

/**
 * The project a task may be filed in by `actor`: live, and one they see.
 * null/'' clears it. Used by the task service on create and change.
 */
export async function projectForTask(actor, raw) {
  if (raw == null || raw === '') return null;
  if (!mongoose.isValidObjectId(raw)) throw fail('That project no longer exists.', 400);
  const p = await staffProjectRepository.findById(raw);
  if (!p || !seesProject(actor, p)) throw fail('That project no longer exists.', 400);
  return p;
}

/** A live project's name, for a task's history (null if gone). */
export async function projectName(id) {
  if (!id) return null;
  return (await staffProjectRepository.findById(id))?.name ?? null;
}

export { PROJECT_STATUSES, PROJECT_COLOURS };
