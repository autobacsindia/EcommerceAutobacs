/**
 * Past team members: people whose staff access was removed, and what they did
 * while they were here, so whoever joins the team next can learn from it.
 *
 * Who sees what:
 *   admin              every team's past members
 *   active staff       their own team's past members only (any role)
 *   anyone else        nothing
 * Someone who may not see a profile gets 404, so its existence does not leak.
 *
 * Only real records are shown; there is no made-up score. Never shown here:
 * the resignation reason, customer names, phones or addresses, personal tasks,
 * and lessons written for another team.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import repo from '../repositories/staffPastMemberRepository.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS, isStaffTeam, staffRoleLabel } from '../config/staff.js';
import { todayIST } from './staffTaskService.js';
import { orderNumber } from './invoiceService.js';

export const PAGE_SIZE = 24;
export const LIST_PAGE = 20;
const MOVES_MAX = 200;
const TRAININGS_MAX = 50;
const LESSONS_MAX = 50;
const DAY_MS = 86400000;

const fail = (message, status) => new AppError(message, status, { expose: true });
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const isPast = (m) => !!m?.staff && m.staff.active === false && m.role !== 'admin';

/** May this viewer see this past member? */
export const canViewPastMember = (viewer, member) => isPast(member)
  && (isAdmin(viewer) || (isActiveStaff(viewer) && viewer.staff.team === member.staff.team));

// ── Cursors: opaque base64url JSON, checked on the way back in ────────────

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function decode(raw, check) {
  if (!raw) return null;
  let v;
  try { v = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')); } catch { v = null; }
  const out = v && typeof v === 'object' && mongoose.isValidObjectId(v.id) ? check(v) : null;
  if (!out) throw fail('Invalid page cursor.', 400);
  return { ...out, id: new mongoose.Types.ObjectId(v.id) };
}
const toDate = (ms) => (Number.isFinite(ms) ? new Date(ms) : undefined);
const decodeAt = (raw, allowNull) => decode(raw, (v) => {
  if (v.at === null && allowNull) return { at: null };
  const at = toDate(v.at);
  return at ? { at } : null;
});
const decodeRank = (raw) => decode(raw, (v) => (typeof v.rank === 'string' && v.rank.length <= 40 ? { rank: v.rank } : null));

// ── Shapes ────────────────────────────────────────────────────────────────

const istDay = (d) => (d ? todayIST(new Date(d)) : null);
/** The role they held, worded as it was while they were here. */
const roleAtLeaving = (m) => staffRoleLabel({ ...m, role: 'staff', staff: { ...m.staff, active: true } }) || 'Member';

function summary(m, departure) {
  const joined = m.staff.addedAt || null;
  const left = m.staff.deactivatedAt || null;
  return {
    id: String(m._id),
    name: m.name || '',
    team: m.staff.team,
    teamLabel: STAFF_TEAM_LABELS[m.staff.team] || m.staff.team,
    roleLabel: roleAtLeaving(m),
    joinedOn: istDay(joined),
    lastDay: departure?.lastDay || istDay(left),
    daysOnTeam: joined && left ? Math.max(0, Math.round((new Date(left) - new Date(joined)) / DAY_MS)) : null,
  };
}

// ── List ──────────────────────────────────────────────────────────────────

/** Admin picks any team (or all); everyone else sees their own team only. */
function teamFor(actor, requested) {
  if (isAdmin(actor)) {
    if (!requested) return null;
    if (!isStaffTeam(requested)) throw fail('Choose a valid team.', 400);
    return requested;
  }
  if (!isActiveStaff(actor)) throw fail('Not available.', 403);
  return actor.staff.team;
}

export async function listPastMembers(actor, { team, cursor } = {}) {
  const scope = teamFor(actor, team);
  const rows = await repo.page(scope, decodeAt(cursor, true), PAGE_SIZE + 1);
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return {
    members: page.map((m) => summary(m, null)),
    team: scope,
    nextCursor: more ? encode({ at: last.staff.deactivatedAt ? new Date(last.staff.deactivatedAt).getTime() : null, id: String(last._id) }) : null,
  };
}

// ── Profile ───────────────────────────────────────────────────────────────

export async function loadMember(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Not found.', 404);
  const m = await repo.findMember(id);
  if (!m || !canViewPastMember(actor, m)) throw fail('Not found.', 404);
  return m;
}

/** Tasks a non-admin sees: those their team was on, never personal ones. */
const taskFilter = (actor, m) => repo.doneTaskFilter(m._id, isAdmin(actor) ? null : actor.staff.team);
const lessonAudiences = (actor) => (isAdmin(actor) ? null : ['company', actor.staff.team]);

function salesFrom(orderRows, quoteRows, leadRows) {
  const by = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  let paidCount = 0; let paidValue = 0; let returned = 0; let cancelled = 0; let waiting = 0;
  for (const r of orderRows) {
    const { status, paymentStatus } = r._id || {};
    if (status === 'returned') returned += r.count;
    else if (status === 'cancelled') cancelled += r.count;
    else if (paymentStatus === 'paid') { paidCount += r.count; paidValue += r.value || 0; } else waiting += r.count;
  }
  const quotes = by(quoteRows);
  const leads = by(leadRows);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    orders: { paid: paidCount, paidValue: Math.round(paidValue * 100) / 100, notPaid: waiting, returned, cancelled },
    quotations: { sent: total(quotes), accepted: quotes.accepted || 0 },
    leads: { total: total(leads), won: leads.won || 0, lost: leads.lost || 0 },
  };
}

async function handoverOf(m) {
  const d = await repo.lastDeparture(m._id, m.staff.team);
  if (!d) return { departure: null, handover: null };
  // The person has lost access, so an "open" record is really finished: close it, as the departure screens do.
  if (d.status === 'open') {
    await repo.markDepartureLeft(d._id).catch((err) => console.error(`Past member: closing departure ${d._id} failed: ${err.message}`));
  }
  const moves = await repo.moves(d._id, MOVES_MAX);
  return {
    departure: d,
    handover: {
      note: d.note || '',
      noteByName: d.noteByName || '',
      noteAt: d.noteAt || null,
      takenOverBy: d.successorName || '',
      moved: moves.map((x) => ({ kind: x.kind, label: x.label, toName: x.toName, at: x.at })),
    },
  };
}

export async function getPastMember(actor, id) {
  const m = await loadMember(actor, id);
  const isGtm = m.staff.team === STAFF_TEAMS.SALES;
  const [{ departure, handover }, tasksDone, trainings, lessons, sales] = await Promise.all([
    handoverOf(m),
    repo.countTasks(taskFilter(actor, m)),
    repo.trainings(m._id, TRAININGS_MAX),
    repo.lessons(m._id, lessonAudiences(actor), LESSONS_MAX),
    isGtm
      ? Promise.all([repo.orderTotals(m._id), repo.quotationTotals(m._id), repo.leadTotals(m._id)]).then((r) => salesFrom(...r))
      : null,
  ]);
  const takenOverBy = handover?.takenOverBy || [...new Set((handover?.moved || []).map((x) => x.toName).filter(Boolean))].join(', ');
  return {
    ...summary(m, departure),
    takenOverBy,
    sales,
    tasksDone,
    training: trainings.map((t) => ({
      id: String(t._id), title: t.pathTitle, status: t.status, signedOffAt: t.signedOffAt || null, signedOffByName: t.signedOffByName || '',
    })),
    lessons: lessons.map((l) => ({ id: String(l._id), title: l.title, audience: l.audience, createdAt: l.createdAt })),
    handover,
  };
}

export async function listPastMemberTasks(actor, id, { cursor } = {}) {
  const m = await loadMember(actor, id);
  const rows = await repo.taskPage(taskFilter(actor, m), decodeRank(cursor), LIST_PAGE + 1);
  const more = rows.length > LIST_PAGE;
  const page = more ? rows.slice(0, LIST_PAGE) : rows;
  const last = page[page.length - 1];
  return {
    tasks: page.map((t) => ({ id: String(t._id), number: t.number, title: t.title, completedAt: t.completedAt })),
    nextCursor: more ? encode({ rank: last.rank, id: String(last._id) }) : null,
  };
}

/** Their orders: number, date, amount and status only — never the customer. */
export async function listPastMemberOrders(actor, id, { cursor } = {}) {
  const m = await loadMember(actor, id);
  if (m.staff.team !== STAFF_TEAMS.SALES) return { orders: [], nextCursor: null };
  const rows = await repo.orderPage(m._id, decodeAt(cursor, false), LIST_PAGE + 1);
  const more = rows.length > LIST_PAGE;
  const page = more ? rows.slice(0, LIST_PAGE) : rows;
  const last = page[page.length - 1];
  return {
    orders: page.map((o) => ({
      id: String(o._id), number: orderNumber(o), createdAt: o.createdAt, totalAmount: o.totalAmount, status: o.status, paymentStatus: o.paymentStatus,
    })),
    nextCursor: more ? encode({ at: new Date(last.createdAt).getTime(), id: String(last._id) }) : null,
  };
}
