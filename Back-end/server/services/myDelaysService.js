/**
 * "My delays" v1 — every order step, parcel, task and project a person owns that
 * is late, due today or still pending, read from TODAY's live data.
 *
 * Read-only. Nothing here writes, alerts or records: the follow-up engine
 * (piece A, models/FollowUpDelay) keeps the permanent delay records; piece G
 * switches this page onto them. Until then this answers "what is late right
 * now, and whose is it?" from the same facts the team panel shows.
 *
 * Who owns a step (shared contract, followup-design.md):
 *   - an order line: whoever moved THAT line into its stage — the latest
 *     workflow history entry for the line that names a person (`by`);
 *   - a parcel in transit: whoever set its expected date, else whoever dispatched it;
 *   - a task: each person it is given to; a project: its owner.
 *   When that person is a System entry, inactive or gone, the step falls to the
 *   head of the team whose queue the stage sits in; with no head, to the admins.
 *
 * How late is counted in OFFICE minutes (Mon–Sat 09:30–18:30 IST, holidays off),
 * against the per-stage SLA below. Bounded: the open workflow is walked with the
 * keyset index `team_workflow_open` (MAX_ORDERS), tasks and projects through
 * their (bucket|archivedAt, rank) indexes, each with a hard cap and `.lean()`
 * projections. Lists are keyset-paginated on the computed order.
 */
import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import myDelaysRepository from '../repositories/myDelaysRepository.js';
import { workflowView, STAGE, STAGE_LABELS, STAGE_TEAM } from '../utils/teamWorkflow.js';
import { SHIPMENT_STATUS } from '../utils/orderFulfilment.js';
import { istDay, addDays, currentOverdueReason, OVERDUE_REASONS } from '../utils/parcelEta.js';
import { orderNumber } from './invoiceService.js';
import { staffHolidays } from '../config/projectTemplates.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import AppError from '../utils/AppError.js';

// ─────────────────────────────────────────────────────────────────────────────
// TODO(piece G): switch to config/followUp.js (piece A owns it) once it is merged.
// A deliberate, small COPY of the contract's defaults so piece H imports nothing
// from piece A. Keep the numbers identical to followup-design.md.
// ─────────────────────────────────────────────────────────────────────────────
export const DELAY_DEFAULTS = Object.freeze({
  office: Object.freeze({ startMin: 9 * 60 + 30, endMin: 18 * 60 + 30, days: Object.freeze([1, 2, 3, 4, 5, 6]) }),
  /** SLA per stage in OFFICE minutes. SHIPPED is date based (see parcelDueAt). */
  slaMinutes: Object.freeze({
    [STAGE.STOCK_CHECK]: 120,
    [STAGE.OWN_STOCK]: 540,
    [STAGE.TO_SHIP]: 240,
    [STAGE.PAYMENT_PENDING]: 240,
    [STAGE.WITH_SUPPLIER]: 3 * 540, // no supplier-promised date is stored yet → 3 office days
    [STAGE.CUSTOMER_DECISION]: 240,
    [STAGE.ACCOUNTS_APPROVAL]: 540,
  }),
  /** A parcel with no expected date is late 3 office days after it left. */
  parcelNoEtaMinutes: 3 * 540,
  /** Reasons that are outside the owner's control. Everything else — and no reason — is inside. */
  outsideReasons: Object.freeze(['courier_delay', 'customer_unreachable', 'address_issue', 'force_majeure']),
});

/** Scan caps: a page that hits one says `truncated` instead of silently dropping work. */
export const MAX_ORDERS = 5000;
export const MAX_TASKS = 2000;
export const MAX_PROJECTS = 500;
const ORDER_PAGE = 100;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const IST_MS = 5.5 * 60 * MIN_MS;
const TRANSIT_TEAM = 'operations';
const BUCKET_RANK = { late: 0, today: 1, pending: 2 };

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const fail = (message, status) => new AppError(message, status, { expose: true });

// ── Office clock (holiday aware) ─────────────────────────────────────────────

/** The office calendar: hours from DELAY_DEFAULTS, holidays from STAFF_HOLIDAYS / SUPPORT_HOLIDAYS. */
export const officeCalendar = (env = process.env) => ({ ...DELAY_DEFAULTS.office, holidays: staffHolidays(env) });

/** IST midnight (as a UTC ms) of the day holding `ms`. */
const istMidnight = (ms) => ms - ((ms + IST_MS) % DAY_MS);
const isWorkDay = (midnight, office) => {
  const day = new Date(midnight + IST_MS).getUTCDay();
  return office.days.includes(day) && !office.holidays?.has(istDay(midnight));
};

/** Office minutes between two moments (0 when `to` is not after `from`). Bounded to ~2 years of days. */
export function officeMinutesBetween(from, to, office = officeCalendar()) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!(b > a)) return 0;
  let total = 0;
  let midnight = istMidnight(a);
  for (let guard = 0; midnight < b && guard < 800; guard += 1, midnight += DAY_MS) {
    if (!isWorkDay(midnight, office)) continue;
    const open = midnight + office.startMin * MIN_MS;
    const close = midnight + office.endMin * MIN_MS;
    const lo = Math.max(a, open);
    const hi = Math.min(b, close);
    if (hi > lo) total += (hi - lo) / MIN_MS;
  }
  return Math.floor(total);
}

/** The moment `minutes` office minutes after `from` (nights, Sundays and holidays do not count). */
export function addOfficeMinutes(from, minutes, office = officeCalendar()) {
  const a = new Date(from).getTime();
  let left = minutes;
  let midnight = istMidnight(a);
  for (let guard = 0; guard < 800; guard += 1, midnight += DAY_MS) {
    if (!isWorkDay(midnight, office)) continue;
    const open = Math.max(a, midnight + office.startMin * MIN_MS);
    const close = midnight + office.endMin * MIN_MS;
    if (close <= open) continue;
    const room = (close - open) / MIN_MS;
    if (left <= room) return new Date(open + left * MIN_MS);
    left -= room;
  }
  return new Date(midnight);
}

// ── Reasons ──────────────────────────────────────────────────────────────────

/** Inside or outside the owner's control. No reason given counts as inside. */
export const controlOf = (code) => (code && DELAY_DEFAULTS.outsideReasons.includes(code) ? 'outside' : 'inside');

const reasonView = (r) => (r?.code ? {
  code: r.code,
  label: OVERDUE_REASONS[r.code] || (r.code === 'force_majeure' ? 'Holiday / force majeure' : 'Other'),
  note: r.note || '',
  by: r.byName || '',
  at: r.at || null,
  control: controlOf(r.code),
} : null);

// ── Owner attribution ────────────────────────────────────────────────────────

const isActivePerson = (u) => !!u && (u.role === 'admin' || (u.role === 'staff' && u.staff?.active === true));
const teamOfUser = (u) => (u?.role === 'admin' ? 'admin' : u?.staff?.team || null);

/**
 * Resolves who owns a step. `people` holds every user named as a candidate,
 * `heads` the active head per team (the first by id when a team has several).
 */
export function makeOwnerResolver(people, heads) {
  return (candidateId, team) => {
    const u = candidateId ? people.get(idOf(candidateId)) : null;
    if (isActivePerson(u)) return { id: idOf(u._id), name: u.name || '', team: teamOfUser(u), via: 'moved' };
    const head = team ? heads.get(team) : null;
    if (head) return { id: idOf(head._id), name: head.name || '', team, via: 'head' };
    return { id: null, name: 'Admins (no team head)', team: team || 'admin', via: 'admins' };
  };
}

/** The latest history entry for each line that names a person, and the latest touch (any entry). */
function lineHistory(order) {
  const touched = new Map();
  const mover = new Map();
  for (const e of order.workflow?.history || []) {
    if (!e.itemId || !e.at) continue;
    const id = idOf(e.itemId);
    const at = new Date(e.at).getTime();
    if (!(touched.get(id) > at)) touched.set(id, at);
    if (e.by && !(mover.get(id)?.at > at)) mover.set(id, { at, by: idOf(e.by) });
  }
  return { touched, mover };
}

// ── Building the items (pure: everything it needs is passed in) ─────────────

const bucketFor = (dueMs, nowMs, today) => {
  if (nowMs >= dueMs) return 'late';
  return istDay(dueMs) === today ? 'today' : 'pending';
};

/**
 * Every step one open order is waiting on, with its owner candidate: lines in a
 * team stage and parcels in transit. Owners are resolved later in one batch.
 */
export function orderSteps(order, { now, office }) {
  const view = workflowView(order);
  if (!view) return [];
  const nowMs = new Date(now).getTime();
  const today = istDay(nowMs);
  const entered = new Date(order.workflow.enteredAt).getTime();
  const { touched, mover } = lineHistory(order);
  const number = orderNumber(order);
  const customer = order.shippingAddress?.fullName || order.user?.name || '';
  const out = [];

  for (const line of view.lines) {
    const team = STAGE_TEAM[line.stage];
    if (!team) continue;
    const item = (order.items || []).find((i) => idOf(i._id) === line.itemId);
    const since = touched.get(line.itemId) ?? entered;
    const sla = DELAY_DEFAULTS.slaMinutes[line.stage];
    const dueMs = addOfficeMinutes(since, sla, office).getTime();
    const bucket = bucketFor(dueMs, nowMs, today);
    out.push({
      key: `order:${idOf(order._id)}:${line.stage}:${line.itemId}`,
      kind: 'order_step',
      candidate: mover.get(line.itemId)?.by || null,
      stageTeam: team,
      bucket,
      title: `${number} · ${item?.name || 'Item'}`,
      subtitle: customer,
      stage: line.stage,
      stageLabel: line.stageLabel || STAGE_LABELS[line.stage],
      since: new Date(since),
      dueAt: new Date(dueMs),
      minutesLate: bucket === 'late' ? officeMinutesBetween(dueMs, nowMs, office) : 0,
      reason: null, // order steps have no reason field until piece D
      nextFollowUp: null,
      flags: { noEta: false },
      order: { id: idOf(order._id), number },
      shipmentId: null,
      etaDay: null,
      task: null,
      project: null,
    });
  }

  for (const id of view.inTransitShipmentIds) {
    const p = (order.shipments || []).find((s) => idOf(s._id) === id);
    if (p?.status !== SHIPMENT_STATUS.SHIPPED) continue;
    const since = new Date(p.shippedAt || p.createdAt || entered).getTime();
    const etaDay = p.eta?.day || null;
    // ETA: end of that India day + one calendar day. No ETA: 3 office days after it left.
    const dueMs = etaDay
      ? Date.parse(`${addDays(etaDay, 2)}T00:00:00+05:30`)
      : addOfficeMinutes(since, DELAY_DEFAULTS.parcelNoEtaMinutes, office).getTime();
    // Past its expected date is already "today's" job (give a reason), even before the SLA runs out.
    let bucket = bucketFor(dueMs, nowMs, today);
    if (bucket === 'pending' && etaDay && etaDay <= today) bucket = 'today';
    out.push({
      key: `parcel:${idOf(order._id)}:${id}`,
      kind: 'parcel',
      candidate: p.eta?.setBy ? idOf(p.eta.setBy) : (p.createdBy ? idOf(p.createdBy) : null),
      stageTeam: TRANSIT_TEAM,
      bucket,
      // The courier is `carrier.name` (models/Order.js shipments[]); older parcels may have none.
      title: `${number} · Parcel${[p.carrier?.name, p.trackingNumber].filter(Boolean).length ? ` (${[p.carrier?.name, p.trackingNumber].filter(Boolean).join(' ')})` : ''}`,
      subtitle: customer,
      stage: STAGE.SHIPPED,
      stageLabel: STAGE_LABELS[STAGE.SHIPPED],
      since: new Date(since),
      dueAt: new Date(dueMs),
      minutesLate: bucket === 'late' ? officeMinutesBetween(dueMs, nowMs, office) : 0,
      reason: reasonView(currentOverdueReason(p)),
      nextFollowUp: etaDay && etaDay >= today ? etaDay : null,
      flags: { noEta: !etaDay },
      order: { id: idOf(order._id), number },
      shipmentId: id,
      etaDay,
      task: null,
      project: null,
    });
  }
  return out;
}

/** Due moment of a task: its time on the due day, else the close of office that day. */
const taskDueMs = (t, office) => (t.dueTime
  ? Date.parse(`${t.dueOn}T${t.dueTime}:00+05:30`)
  : Date.parse(`${t.dueOn}T00:00:00+05:30`) + office.endMin * MIN_MS);

/** One item per person a task is given to. */
export function taskItems(task, { now, office }) {
  const nowMs = new Date(now).getTime();
  const today = istDay(nowMs);
  if (!task.dueOn) return [];
  const dueMs = taskDueMs(task, office);
  // Untimed: late from the next day (same rule as the Tasks page), due today until then.
  const late = task.dueTime ? nowMs >= dueMs : task.dueOn < today;
  const bucket = late ? 'late' : (task.dueOn === today ? 'today' : 'pending');
  const people = task.assignees?.length ? task.assignees : [{ user: task.assignee, name: task.assigneeName, team: task.team }];
  return people.filter((p) => p?.user).map((p) => ({
    key: `task:${idOf(task._id)}:${idOf(p.user)}`,
    kind: 'task',
    candidate: idOf(p.user),
    stageTeam: p.team || null,
    bucket,
    title: `T-${task.number} · ${task.title}`,
    subtitle: task.stageName || '',
    stage: 'task',
    stageLabel: 'Task',
    since: null,
    dueAt: new Date(dueMs),
    minutesLate: late ? officeMinutesBetween(dueMs, nowMs, office) : 0,
    reason: null,
    nextFollowUp: task.dueOn,
    flags: { noEta: false },
    order: null,
    shipmentId: null,
    etaDay: null,
    task: { id: idOf(task._id), number: task.number, rev: task.rev || 1, project: task.project ? idOf(task.project) : null },
    project: null,
  }));
}

export function projectItem(project, { now, office }) {
  const nowMs = new Date(now).getTime();
  const today = istDay(nowMs);
  const dueMs = Date.parse(`${project.dueOn}T00:00:00+05:30`) + office.endMin * MIN_MS;
  const late = project.dueOn < today;
  return {
    key: `project:${idOf(project._id)}`,
    kind: 'project',
    candidate: project.owner?.user ? idOf(project.owner.user) : null,
    stageTeam: project.owner?.team || null,
    bucket: late ? 'late' : 'today',
    title: `${project.number ? `PRJ-${project.number}` : 'Project'} · ${project.name}`,
    subtitle: `${project.openTasks} open task${project.openTasks === 1 ? '' : 's'}`,
    stage: 'project',
    stageLabel: 'Project deadline',
    since: null,
    dueAt: new Date(dueMs),
    minutesLate: late ? officeMinutesBetween(dueMs, nowMs, office) : 0,
    reason: null,
    nextFollowUp: project.dueOn,
    flags: { noEta: false },
    order: null,
    shipmentId: null,
    etaDay: null,
    task: null,
    project: { id: idOf(project._id), code: project.number ? `PRJ-${project.number}` : '' },
  };
}

// ── Loading (bounded, lean, projected) ───────────────────────────────────────

async function scanOrders() {
  const orders = [];
  let after = null;
  let truncated = false;
  for (;;) {
    const page = await orderRepository.findOpenWorkflowPage({ after, limit: ORDER_PAGE });
    orders.push(...page);
    if (page.length < ORDER_PAGE) break;
    if (orders.length >= MAX_ORDERS) { truncated = true; break; }
    const last = page[page.length - 1];
    after = { enteredAt: last.workflow.enteredAt, id: last._id };
  }
  return { orders, truncated };
}

/** Open, non-personal tasks due on or before today, optionally for one person or team. */
async function scanTasks({ userId = null, team = null }, today) {
  const tasks = await myDelaysRepository.findDueTasks({ userId, team, beforeRank: addDays(today, 1), limit: MAX_TASKS + 1 });
  return { tasks: tasks.slice(0, MAX_TASKS), truncated: tasks.length > MAX_TASKS };
}

/** Projects due by today that still have open tasks and are not marked done (services/staffProjectService statusOf). */
async function scanProjects({ userId = null, team = null }, today) {
  const found = await myDelaysRepository.findDueProjects({ userId, team, uptoRank: today, limit: MAX_PROJECTS + 1 });
  const projects = found.slice(0, MAX_PROJECTS).filter((p) => p.dueOn);
  const counts = await myDelaysRepository.countOpenTasksByProject(projects.map((p) => p._id));
  const open = new Map(counts.map((c) => [idOf(c._id), c.n]));
  return {
    projects: projects.filter((p) => open.get(idOf(p._id)) > 0).map((p) => ({ ...p, openTasks: open.get(idOf(p._id)) })),
    truncated: found.length > MAX_PROJECTS,
  };
}

async function loadPeople(ids) {
  const unique = [...new Set(ids.filter(Boolean))].filter((x) => mongoose.isValidObjectId(x));
  const [people, headList] = await Promise.all([
    myDelaysRepository.findPeople(unique),
    myDelaysRepository.findActiveHeads(),
  ]);
  const heads = new Map();
  for (const h of headList) if (!heads.has(h.staff.team)) heads.set(h.staff.team, h);
  return { people: new Map(people.map((u) => [idOf(u._id), u])), heads };
}

/**
 * Every delay item in scope, owners resolved. `scope`:
 *   { userId }  — one person's items (tasks/projects scanned for them only)
 *   { team }    — items owned by that team
 *   {}          — everyone (admin)
 */
export async function collectDelays(scope = {}, { now = new Date(), env = process.env } = {}) {
  const office = officeCalendar(env);
  const today = istDay(new Date(now).getTime());
  const [o, t, p] = await Promise.all([scanOrders(), scanTasks(scope, today), scanProjects(scope, today)]);
  const raw = [
    ...o.orders.flatMap((order) => orderSteps(order, { now, office })),
    ...t.tasks.flatMap((task) => taskItems(task, { now, office })),
    ...p.projects.map((project) => projectItem(project, { now, office })),
  ];
  const { people, heads } = await loadPeople(raw.map((r) => r.candidate));
  const resolve = makeOwnerResolver(people, heads);
  let items = raw.map(({ candidate, stageTeam, ...rest }) => ({
    ...rest,
    team: stageTeam,
    control: rest.reason?.control || 'inside',
    owner: resolve(candidate, stageTeam),
  }));
  if (scope.userId) items = items.filter((i) => i.owner.id === String(scope.userId));
  else if (scope.team) items = items.filter((i) => i.owner.team === scope.team);
  return { items, truncated: o.truncated || t.truncated || p.truncated, asOf: new Date(now) };
}

// ── Filters, order, keyset pages ─────────────────────────────────────────────

/** Late → due today → pending; most late first; then soonest due; key breaks ties. */
export const compareItems = (a, b) => (BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket])
  || (b.minutesLate - a.minutesLate)
  || (new Date(a.dueAt) - new Date(b.dueAt))
  || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function applyFilters(items, { control, from, to } = {}) {
  return items.filter((i) => {
    if (control && !(i.bucket === 'late' && i.control === control)) return false;
    const day = istDay(new Date(i.dueAt).getTime());
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function decode(cursor) {
  if (!cursor) return null;
  try { return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); } catch { throw fail('That page link is no longer valid. Reload the list.', 400); }
}
export const clampLimit = (limit) => Math.min(PAGE_MAX, Math.max(1, Number.parseInt(limit, 10) || PAGE_DEFAULT));

/**
 * One keyset page of an already-sorted list: the cursor is the sort tuple of
 * the last row shown, so a row that changes bucket between pages is neither
 * repeated nor skipped past its new place.
 */
export function pageOf(sorted, { cursor, limit }, tupleOf, compare) {
  const size = clampLimit(limit);
  const after = decode(cursor);
  const start = after ? sorted.findIndex((row) => compare(tupleOf(row), after) > 0) : 0;
  const rows = start < 0 ? [] : sorted.slice(start, start + size);
  const more = start >= 0 && start + size < sorted.length;
  return { rows, nextCursor: more ? encode(tupleOf(rows[rows.length - 1])) : null };
}

const itemTuple = (i) => ({ b: i.bucket, m: i.minutesLate, d: new Date(i.dueAt).getTime(), k: i.key });
const itemTupleCompare = (x, y) => (BUCKET_RANK[x.b] - BUCKET_RANK[y.b]) || (y.m - x.m) || (x.d - y.d) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0);

const summarize = (items) => ({
  late: items.filter((i) => i.bucket === 'late').length,
  today: items.filter((i) => i.bucket === 'today').length,
  pending: items.filter((i) => i.bucket === 'pending').length,
  noReason: items.filter((i) => i.bucket === 'late' && !i.reason).length,
  noEta: items.filter((i) => i.flags.noEta).length,
  outside: items.filter((i) => i.bucket === 'late' && i.control === 'outside').length,
  minutesLate: items.reduce((s, i) => s + i.minutesLate, 0),
});

function itemsPage(items, query) {
  const sorted = applyFilters(items, query).sort(compareItems);
  const { rows, nextCursor } = pageOf(sorted, query, itemTuple, itemTupleCompare);
  return { summary: summarize(sorted), items: rows, nextCursor };
}

// ── Access ───────────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isHead = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff?.isHead === true;

/** The caller's own list. */
export async function myDelays(viewer, query = {}, opts = {}) {
  const { items, truncated, asOf } = await collectDelays({ userId: idOf(viewer._id) }, opts);
  return { person: { id: idOf(viewer._id), name: viewer.name || '', team: teamOfUser(viewer) }, ...itemsPage(items, query), truncated, asOf };
}

/** One person's list: themselves, their team head, or an admin. Never anyone else (404, not 200). */
export async function personDelays(viewer, personId, query = {}, opts = {}) {
  if (!mongoose.isValidObjectId(personId)) throw fail('Person not found.', 404);
  if (idOf(viewer._id) === String(personId)) return myDelays(viewer, query, opts);
  if (!isAdmin(viewer) && !isHead(viewer)) throw fail('Only a team head or an admin can see someone else’s delays.', 403);
  const person = await myDelaysRepository.findPerson(personId);
  if (!person || (person.role !== 'staff' && person.role !== 'admin' && !person.staff)) throw fail('Person not found.', 404);
  if (!isAdmin(viewer) && person.staff?.team !== viewer.staff.team) throw fail('You can only see people in your own team.', 403);
  const { items, truncated, asOf } = await collectDelays({ userId: String(personId) }, opts);
  return { person: { id: idOf(person._id), name: person.name || '', team: teamOfUser(person) }, ...itemsPage(items, query), truncated, asOf };
}

/**
 * The ranking: one row per owner, most late items first, then most office time
 * late. A head sees their own team only (the `team` filter cannot widen it); an
 * admin sees everyone and may filter by team. Plain staff are refused (403).
 */
export async function teamDelays(viewer, query = {}, opts = {}) {
  if (!isAdmin(viewer) && !isHead(viewer)) throw fail('Only a team head or an admin can see the team’s delays.', 403);
  const team = isAdmin(viewer) ? (query.team || null) : viewer.staff.team;
  const { items, truncated, asOf } = await collectDelays(team ? { team } : {}, opts);
  const filtered = applyFilters(items, query).filter((i) => !query.person || i.owner.id === String(query.person));
  const byOwner = new Map();
  for (const i of filtered) {
    const k = i.owner.id || `none:${i.owner.team}`;
    if (!byOwner.has(k)) byOwner.set(k, { id: i.owner.id, name: i.owner.name, team: i.owner.team, teamLabel: STAFF_TEAM_LABELS[i.owner.team] || (i.owner.team === 'admin' ? 'Admin' : i.owner.team), items: [] });
    byOwner.get(k).items.push(i);
  }
  const rows = [...byOwner.entries()].map(([k, o]) => ({ key: k, id: o.id, name: o.name, team: o.team, teamLabel: o.teamLabel, ...summarize(o.items) }));
  const tuple = (r) => ({ l: r.late, m: r.minutesLate, t: r.today, k: r.key });
  const cmp = (x, y) => (y.l - x.l) || (y.m - x.m) || (y.t - x.t) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0);
  rows.sort((a, b) => cmp(tuple(a), tuple(b)));
  const { rows: people, nextCursor } = pageOf(rows, query, tuple, cmp);
  return { scope: team ? { team } : { team: null }, totals: summarize(filtered), people, nextCursor, truncated, asOf };
}
