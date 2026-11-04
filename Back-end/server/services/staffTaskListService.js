/**
 * Folders and lists in a team's task space (models/StaffTaskList.js).
 *
 * Who sees a space: everyone in that team (like a Google Chat space), and the
 * admin every space. Who arranges it — makes, renames, recolours, moves and
 * deletes folders and lists: the admin, and the head of that team.
 *
 * Deleting a list puts its tasks back in the space's "Other tasks"; deleting a
 * folder deletes the lists in it the same way. A task is never lost to a list.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffTaskListRepository, { TASK_LIST_KINDS, TASK_LIST_COLOURS } from '../repositories/staffTaskListRepository.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import { STAFF_TEAM_LABELS, isStaffTeam } from '../config/staff.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

/** Folders and lists together, per space: keeps the sidebar (and its one read) small. */
export const LISTS_MAX = 100;
export const LIST_NAME_MAX = 60;

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const teamOf = (u) => (isActiveStaff(u) ? u.staff.team : null);

export const canManageSpace = (u, team) => isAdmin(u) || (isActiveStaff(u) && u.staff.isHead === true && u.staff.team === team);

/** The space `actor` asks for, if they may see it: their own team, or any team for the admin. */
function spaceFor(actor, team) {
  const want = team || teamOf(actor);
  if (!want || !isStaffTeam(want)) throw fail('Pick a team.', 400);
  if (!isAdmin(actor) && want !== teamOf(actor)) throw fail('You can only see your own team\'s space.', 403);
  return want;
}

export function cleanListName(raw) {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) throw fail('Give it a name.', 400);
  if (name.length > LIST_NAME_MAX) throw fail(`Keep the name under ${LIST_NAME_MAX} characters.`, 400);
  return name;
}
const keyOf = (name) => name.toLowerCase();

function cleanColour(raw) {
  if (raw == null || raw === '') return 'gray';
  if (!TASK_LIST_COLOURS.includes(raw)) throw fail('Pick one of the colours.', 400);
  return raw;
}

const shapeItem = (x, open = 0) => ({
  id: idOf(x._id),
  kind: x.kind,
  name: x.name,
  colour: x.colour || 'gray',
  folderId: idOf(x.folder),
  rev: x.rev,
  open,
});

const kindWord = (kind) => (kind === 'folder' ? 'folder' : 'list');
const taken = (kind, name) => fail(`There is already a ${kindWord(kind)} called “${name}” here.`, 409);

/** A live folder of `team`, for a list to go in (or null for straight in the space). */
async function folderIn(team, raw) {
  if (raw == null || raw === '') return null;
  if (!mongoose.isValidObjectId(raw)) throw fail('That folder no longer exists.', 400);
  const f = await staffTaskListRepository.findById(raw);
  if (!f || f.archivedAt || f.kind !== 'folder' || f.team !== team) throw fail('That folder no longer exists.', 400);
  return f;
}

async function loadManaged(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('That folder or list no longer exists.', 404);
  const x = await staffTaskListRepository.findById(id);
  // Not "forbidden" for another team's: it does not exist for you.
  if (!x || x.archivedAt || (!isAdmin(actor) && x.team !== teamOf(actor))) throw fail('That folder or list no longer exists.', 404);
  if (!canManageSpace(actor, x.team)) throw fail('Only the team head or the admin can change folders and lists.', 403);
  return x;
}

/**
 * A space's tree: its folders (each with its lists), the lists straight in the
 * space, and how many open tasks each holds — `other` is "Other tasks".
 */
export async function getSpace(actor, team) {
  const space = spaceFor(actor, team);
  const [rows, counts] = await Promise.all([
    staffTaskListRepository.findLive(space),
    staffTaskRepository.openCountsByList(space),
  ]);
  const open = new Map(counts.map((c) => [idOf(c._id), c.n]));
  const live = new Set(rows.map((r) => idOf(r._id)));
  // Tasks still pointing at a list deleted mid-way count as "Other tasks", where they are listed.
  const other = counts.filter((c) => !c._id || !live.has(idOf(c._id))).reduce((n, c) => n + c.n, 0);
  const folders = rows.filter((r) => r.kind === 'folder').map((f) => ({
    ...shapeItem(f),
    lists: rows.filter((r) => r.kind === 'list' && idOf(r.folder) === idOf(f._id)).map((l) => shapeItem(l, open.get(idOf(l._id)) ?? 0)),
  }));
  const lists = rows.filter((r) => r.kind === 'list' && !r.folder).map((l) => shapeItem(l, open.get(idOf(l._id)) ?? 0));
  return {
    team: space,
    teamLabel: STAFF_TEAM_LABELS[space] || space,
    canManage: canManageSpace(actor, space),
    folders,
    lists,
    other,
    colours: TASK_LIST_COLOURS,
  };
}

export async function createListItem(actor, { team, kind, name: rawName, colour: rawColour, folderId } = {}, req) {
  const space = spaceFor(actor, team);
  if (!canManageSpace(actor, space)) throw fail('Only the team head or the admin can add folders and lists.', 403);
  if (!TASK_LIST_KINDS.includes(kind)) throw fail('Make a folder or a list.', 400);
  const name = cleanListName(rawName);
  const colour = cleanColour(rawColour);
  if (kind === 'folder' && folderId) throw fail('A folder cannot go inside another folder.', 400);
  const folder = kind === 'list' ? await folderIn(space, folderId) : null;
  if ((await staffTaskListRepository.countLive(space)) >= LISTS_MAX) {
    throw fail(`A space can have at most ${LISTS_MAX} folders and lists. Delete some first.`, 400);
  }
  let doc;
  try {
    doc = await staffTaskListRepository.create({
      team: space,
      kind,
      folder: folder?._id ?? null,
      name,
      nameKey: keyOf(name),
      colour,
      order: (await staffTaskListRepository.lastOrder(space)) + 1,
      createdBy: actor._id,
    });
  } catch (err) {
    // The unique name index decides — also between two clicks at the same moment.
    if (err?.code === 11000) throw taken(kind, name);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'StaffTaskList', doc._id, { team: space, kind, name });
  return shapeItem(doc);
}

/** Rename, recolour, or move a list into (or out of) a folder; `rev` is required. */
export async function updateListItem(actor, id, input = {}, req) {
  const x = await loadManaged(actor, id);
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload and try again.', 400);
  if (rev !== x.rev) throw fail('Someone changed this just now. It has been reloaded — try again.', 409);
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const set = {};
  if (has('name')) {
    const name = cleanListName(input.name);
    if (name !== x.name) { set.name = name; set.nameKey = keyOf(name); }
  }
  if (has('colour')) {
    const colour = cleanColour(input.colour);
    if (colour !== x.colour) set.colour = colour;
  }
  if (has('folderId')) {
    if (x.kind === 'folder') {
      if (input.folderId) throw fail('A folder cannot go inside another folder.', 400);
    } else {
      const folder = await folderIn(x.team, input.folderId);
      if (idOf(folder?._id) !== idOf(x.folder)) set.folder = folder?._id ?? null;
    }
  }
  if (!Object.keys(set).length) return shapeItem(x);
  let next;
  try {
    next = await staffTaskListRepository.updateIfRev(x._id, rev, set);
  } catch (err) {
    if (err?.code === 11000) throw taken(x.kind, set.name ?? x.name);
    throw err;
  }
  if (!next) throw fail('Someone changed this just now. It has been reloaded — try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffTaskList', x._id, { changes: Object.keys(set).filter((k) => k !== 'nameKey') });
  return shapeItem(next);
}

/**
 * Delete a list (or a folder and every list in it). Their tasks go back to
 * "Other tasks" first, so a failure half-way leaves the list in place to delete
 * again — never a list gone with tasks still pointing at it. A second sweep
 * after the archive catches a task filed in the moment between the two.
 */
export async function deleteListItem(actor, id, req) {
  const x = await loadManaged(actor, id);
  const inside = x.kind === 'folder' ? await staffTaskListRepository.findInFolder(x._id) : [];
  const ids = [x._id, ...inside.map((l) => l._id)];
  const listIds = x.kind === 'list' ? [x._id] : inside.map((l) => l._id);
  const at = new Date();
  const entry = { at, by: actor._id, byName: actor.name || '', action: 'list', from: x.name, to: '' };
  const unfile = async () => (listIds.length ? (await staffTaskRepository.unfile(listIds, entry)).modifiedCount ?? 0 : 0);
  let moved = await unfile();
  await staffTaskListRepository.archive(ids, at);
  moved += await unfile();
  auditLogger.logAction(req, 'DELETE', 'StaffTaskList', x._id, {
    kind: x.kind, name: x.name, lists: listIds.length, tasks: moved,
  });
  return { deleted: ids.map(idOf), tasksMoved: moved };
}

/**
 * The list a task goes in, checked: live, a list (not a folder), and in a
 * space the task belongs to. Null clears it ("Other tasks").
 */
export async function listForTask(raw, teams) {
  if (raw == null || raw === '') return null;
  if (!mongoose.isValidObjectId(raw)) throw fail('That list no longer exists.', 400);
  const l = await staffTaskListRepository.findById(raw);
  if (!l || l.archivedAt || l.kind !== 'list') throw fail('That list no longer exists.', 400);
  if (!teams.includes(l.team)) {
    throw fail(`“${l.name}” is in ${STAFF_TEAM_LABELS[l.team] || l.team}. Only tasks for someone in that team can go in it.`, 400);
  }
  return l;
}

/** The live list a task points at, or null (a deleted one counts as none). */
export async function liveList(id) {
  if (!id) return null;
  const l = await staffTaskListRepository.findById(id);
  return l && !l.archivedAt && l.kind === 'list' ? l : null;
}
