/**
 * Someone is leaving: last day, private reason, replacement, handover note.
 *
 * Who may do what:
 *   record, edit, cancel, start the handover
 *            admin only (canManage is the one place to widen this, for example
 *            when an HR role exists). Team heads do not.
 *   read a record, including the reason
 *            admin, and the head of the person's team (read-only, to plan cover).
 *            Not another head's record.
 *   write the handover note
 *            admin and the person leaving.
 *   read the handover note
 *            the named replacement. Never the reason.
 * Someone who may not see a record gets 404, so its existence does not leak.
 *
 * This never changes access or moves work. Removing access stays the existing
 * button (staffService.deactivateMember). A record notices that happened when it
 * is next read and closes itself, so that code needs no change here.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import repo from '../repositories/staffDepartureRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { cleanRichTextWithin } from '../utils/richText.js';
import { sendToUsers } from './pushService.js';
import { todayIST } from './staffTaskService.js';

const PAGE_SIZE = 24;
const MINE_MAX = 20;
const BELL_MAX = 200;
const REMIND_DAYS = 3;
const REASON_MAX = 1000;
const NOTE_MAX = 20000;
const LAST_DAY_BACK = 60;
const LAST_DAY_AHEAD = 365;

const fail = (message, status) => new AppError(message, status, { expose: true });
const same = (a, b) => !!a && !!b && String(a) === String(b);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isHead = (u) => isActiveStaff(u) && u.staff.isHead === true;
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);

/** Managing is decided from the person leaving: their team and whether they are a head. */
const canManage = (u, d) => !same(u._id, d.user) && isAdmin(u);
/** The person's own team head: sees it to plan cover, changes nothing. */
const isTeamHeadOf = (u, d) => isHead(u) && u.staff.team === d.team && !d.wasHead && !same(u._id, d.user);
export const canManageDeparture = canManage;
const isLeaver = (u, d) => same(u._id, d.user);
const isSuccessor = (u, d) => same(u._id, d.successor);
const canSee = (u, d) => canManage(u, d) || isTeamHeadOf(u, d) || isLeaver(u, d) || isSuccessor(u, d);
export const canSeeDeparture = canSee;
const canWriteNote = (u, d) => d.status === 'open' && (canManage(u, d) || isLeaver(u, d));

const dayMs = 86400000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

function cleanLastDay(raw, today = todayIST()) {
  const s = String(raw ?? '');
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) throw fail('Choose a valid last day.', 400);
  if (s < addDays(today, -LAST_DAY_BACK) || s > addDays(today, LAST_DAY_AHEAD)) throw fail('That last day is too far from today.', 400);
  return s;
}
function cleanReason(raw) {
  const s = String(raw ?? '').trim();
  if (s.length > REASON_MAX) throw fail(`Keep the reason under ${REASON_MAX} characters.`, 400);
  return s;
}
function cleanNote(raw) {
  const { value, tooLong } = cleanRichTextWithin(raw, NOTE_MAX);
  if (tooLong) throw fail(`Keep the handover note under ${NOTE_MAX} characters.`, 400);
  return value;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
  if (!mongoose.isValidObjectId(raw)) throw fail('Invalid page cursor.', 400);
  return new mongoose.Types.ObjectId(raw);
}

/** Closes records whose person has already lost access; returns those ids. */
async function closeLeft(rows) {
  const open = rows.filter((d) => d.status === 'open');
  if (!open.length) return new Set();
  const still = new Set((await repo.stillStaff(open.map((d) => d.user))).map((u) => String(u._id)));
  const gone = open.filter((d) => !still.has(String(d.user)));
  if (gone.length) await repo.markLeft(gone.map((d) => d._id));
  return new Set(gone.map((d) => String(d._id)));
}

function shape(d, viewer, { full = false, today = todayIST(), left = false } = {}) {
  const status = left ? 'left' : d.status;
  const manage = canManage(viewer, d);
  const privateView = manage || isTeamHeadOf(viewer, d);
  const live = { ...d, status };
  return {
    id: String(d._id),
    user: { id: String(d.user), name: d.userName },
    team: d.team,
    teamLabel: STAFF_TEAM_LABELS[d.team] || d.team,
    lastDay: d.lastDay,
    daysLeft: daysBetween(today, d.lastDay),
    status,
    successor: d.successor ? { id: String(d.successor), name: d.successorName } : null,
    rev: d.rev,
    createdAt: d.createdAt,
    ...(privateView ? { reason: d.reason || '', createdByName: d.createdByName } : {}),
    ...(full ? { note: d.note || '', noteByName: d.noteByName, noteAt: d.noteAt } : {}),
    can: { manage: manage && status === 'open', writeNote: canWriteNote(viewer, live), handover: manage && status !== 'cancelled' },
  };
}

async function loadSuccessor(leaverId, successorId) {
  if (!successorId) return { successor: null, successorName: '' };
  if (same(successorId, leaverId)) throw fail('Choose someone else to take over.', 400);
  const person = await userRepository.findById(successorId);
  if (!isActiveStaff(person)) throw fail('Choose an active team member to take over.', 400);
  return { successor: person._id, successorName: person.name || '' };
}

async function tellSuccessor(d) {
  try {
    await sendToUsers([{ userId: String(d.successor), url: `/team/handover/${d._id}` }], {
      title: 'You are taking over', body: `Please read ${d.userName}'s handover note.`, tag: `handover-${d._id}`,
    });
  } catch (err) {
    console.error(`Handover pop-up failed for ${d._id}: ${err.message}`);
  }
}

export async function recordDeparture(actor, input, req) {
  if (!isAdmin(actor)) throw fail('Only an admin can record a resignation.', 403);
  const target = await userRepository.findById(input.userId);
  if (!isActiveStaff(target)) throw fail('Staff member not found.', 404);
  const lastDay = cleanLastDay(input.lastDay);
  const who = await loadSuccessor(target._id, input.successorId);
  let created;
  try {
    created = await repo.create({
      user: target._id, userName: target.name || '', team: target.staff.team, wasHead: target.staff.isHead === true,
      lastDay, reason: cleanReason(input.reason), ...who, createdBy: actor._id, createdByName: actor.name || '',
    });
  } catch (err) {
    if (err?.code === 11000) throw fail('A resignation is already recorded for this person.', 409);
    throw err;
  }
  // The reason stays out of the log: the log has a wider audience than the record.
  auditLogger.logAction(req, 'CREATE', 'StaffDeparture', created._id, { user: String(target._id), lastDay });
  if (created.successor) await tellSuccessor(created);
  return shape(created, actor, { full: true });
}

export async function listDepartures(actor, { cursor } = {}) {
  if (!isAdmin(actor) && !isHead(actor)) throw fail('Only team heads and admins can see this.', 403);
  const filter = isAdmin(actor) ? {} : { team: actor.staff.team, wasHead: false };
  const rows = await repo.page(filter, { before: decodeCursor(cursor), limit: PAGE_SIZE + 1 });
  const more = rows.length > PAGE_SIZE;
  const page = (more ? rows.slice(0, PAGE_SIZE) : rows).filter((d) => !same(d.user, actor._id));
  const gone = await closeLeft(page);
  return {
    departures: page.map((d) => shape(d, actor, { left: gone.has(String(d._id)) })),
    canRecord: isAdmin(actor),
    nextCursor: more ? Buffer.from(String(rows[PAGE_SIZE - 1]._id)).toString('base64url') : null,
  };
}

/** The handovers I am part of: leaving, or taking over. */
export async function myHandovers(actor) {
  if (!inPanel(actor)) throw fail('Not available.', 403);
  const rows = await repo.openFor(actor._id, MINE_MAX);
  const gone = await closeLeft(rows);
  return { departures: rows.map((d) => ({ ...shape(d, actor, { left: gone.has(String(d._id)) }), mine: isLeaver(actor, d) ? 'leaving' : 'taking_over' })) };
}

async function load(actor, id) {
  const d = await repo.findById(id);
  if (!d || !canSee(actor, d)) throw fail('Not found.', 404);
  return d;
}

export async function getDeparture(actor, id) {
  const d = await load(actor, id);
  const gone = await closeLeft([d]);
  return shape(d, actor, { full: true, left: gone.size > 0 });
}

export async function updateDeparture(actor, id, input, req) {
  const d = await load(actor, id);
  const set = {};
  if (['lastDay', 'reason', 'successorId'].some((k) => input[k] !== undefined)) {
    if (!canManage(actor, d)) throw fail('Only an admin can change this.', 403);
    if (input.lastDay !== undefined) set.lastDay = cleanLastDay(input.lastDay);
    if (input.reason !== undefined) set.reason = cleanReason(input.reason);
    if (input.successorId !== undefined) Object.assign(set, await loadSuccessor(d.user, input.successorId));
  }
  if (input.note !== undefined) {
    if (!canWriteNote(actor, d)) throw fail('You cannot change this note.', 403);
    Object.assign(set, { note: cleanNote(input.note), noteByName: actor.name || '', noteAt: new Date() });
  }
  if (!Object.keys(set).length) return shape(d, actor, { full: true });
  const updated = await repo.updateIfRev(d._id, input.rev, set);
  if (!updated) throw fail('This changed while you were editing. Reload and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffDeparture', d._id, { fields: Object.keys(set).filter((k) => k !== 'reason' && k !== 'note') });
  if (updated.successor && !same(updated.successor, d.successor)) await tellSuccessor(updated);
  return shape(updated, actor, { full: true });
}

export async function cancelDeparture(actor, id, req) {
  const d = await load(actor, id);
  if (!canManage(actor, d)) throw fail('Only an admin can change this.', 403);
  const updated = await repo.cancel(d._id);
  if (!updated) throw fail('This is already closed.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffDeparture', d._id, { change: 'cancelled' });
  return shape(updated, actor, { full: true });
}

/** Last days within 3 days or past, whose access is still on. Never breaks the bell. */
export async function countLastDaysForBell(user) {
  if (!isAdmin(user) && !isHead(user)) return 0;
  try {
    const filter = isAdmin(user) ? {} : { team: user.staff.team, wasHead: false };
    const rows = (await repo.dueBy(filter, addDays(todayIST(), REMIND_DAYS), BELL_MAX)).map((d) => ({ ...d, status: 'open' }));
    const gone = await closeLeft(rows);
    return rows.filter((d) => !gone.has(String(d._id)) && !same(d.user, user._id)).length;
  } catch (err) {
    console.error(`Last-day bell count failed: ${err.message}`);
    return 0;
  }
}
