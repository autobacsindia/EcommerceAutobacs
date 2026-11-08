import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import staffTaskLinkRepository from '../repositories/staffTaskLinkRepository.js';
import { STATUS_LABELS, canEdit, canSee } from './staffTaskService.js';
import { shownStatus } from '../models/StaffTask.js';

/**
 * Links between tasks: "waiting on", "blocking" and "related".
 *
 *   - Adding one needs the right to change this task and the right to see the other.
 *     Removing one needs the right to change either end.
 *   - A link is advice: a waiting task shows a warning, but can still be finished.
 *   - Someone who can't see the task at the other end never gets its name: they
 *     get a count ("1 linked task you can't open").
 *   - Personal tasks link only with each other, or a private title could leak.
 */

export const LINKS_MAX = 30;
const OPTIONS_MAX = 20;
const WALK_MAX = 300; // tasks visited looking for a circle

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => String(v?._id ?? v);
const pairOf = (a, b) => [idOf(a), idOf(b)].sort().join(':');
const isAdmin = (u) => u?.role === 'admin';
const LINK_KINDS = Object.freeze(['waiting_on', 'blocking', 'related']);
const NOT_FOUND = 'Task not found.';

async function loadVisible(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail(NOT_FOUND, 404);
  const t = await staffTaskRepository.findById(id);
  if (!t || !canSee(actor, t)) throw fail(NOT_FOUND, 404);
  return t;
}

const taskOut = (t) => ({
  id: idOf(t._id), code: `T-${t.number}`, title: t.title,
  status: shownStatus(t.status), statusLabel: STATUS_LABELS[shownStatus(t.status)], bucket: t.bucket,
});

/** How this link reads from `taskId`'s side. */
const kindFrom = (link, taskId) => {
  if (link.kind === 'related') return 'related';
  return idOf(link.to) === idOf(taskId) ? 'waiting_on' : 'blocking';
};
const otherEnd = (link, taskId) => (idOf(link.from) === idOf(taskId) ? link.to : link.from);

export async function listLinks(actor, id) {
  const t = await loadVisible(actor, id);
  const links = await staffTaskLinkRepository.forTask(t._id, LINKS_MAX);
  const others = await staffTaskLinkRepository.tasksByIds(links.map((l) => otherEnd(l, t._id)));
  const byId = new Map(others.map((o) => [idOf(o._id), o]));
  const can = canEdit(actor, t) && t.bucket !== 'archived';
  const out = { waitingOn: [], blocking: [], related: [] };
  const buckets = { waiting_on: out.waitingOn, blocking: out.blocking, related: out.related };
  let hidden = 0;
  let hiddenWaiting = 0;
  for (const link of links) {
    const other = byId.get(idOf(otherEnd(link, t._id)));
    if (!other) continue;
    const kind = kindFrom(link, t._id);
    if (!canSee(actor, other)) {
      hidden += 1;
      if (kind === 'waiting_on' && other.bucket === 'open') hiddenWaiting += 1;
      continue;
    }
    buckets[kind].push({ linkId: idOf(link._id), task: taskOut(other), canRemove: canEdit(actor, t) || canEdit(actor, other) });
  }
  return { ...out, hidden, hiddenWaiting, canAdd: can };
}

/** Tasks `actor` may see, as a query. The same rule as canSee, which still checks every row after. */
function visibleTo(actor) {
  if (isAdmin(actor)) return { $or: [{ personal: { $ne: true } }, { createdBy: actor._id }] };
  const team = actor.staff?.team;
  return {
    $or: [
      { 'assignees.user': actor._id }, { 'followers.user': actor._id }, { createdBy: actor._id },
      ...(team ? [{ teams: team }] : []),
    ],
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tasks that could be linked to this one, for the picker: a T-number or words in the title. */
export async function linkOptions(actor, id, { q } = {}) {
  const t = await loadVisible(actor, id);
  if (!canEdit(actor, t) || t.bucket === 'archived') throw fail('Only whoever gave this task, the team head or the admin can link it.', 403);
  const term = String(q ?? '').trim().slice(0, 100);
  const numeric = term.match(/^t?-?\s*(\d{1,9})$/i);
  const linked = await staffTaskLinkRepository.forTask(t._id, LINKS_MAX);
  const rows = await staffTaskLinkRepository.search(visibleTo(actor), {
    number: numeric ? Number(numeric[1]) : null,
    title: term && !numeric ? { $regex: escapeRegex(term), $options: 'i' } : null,
    not: [t._id, ...linked.map((l) => otherEnd(l, t._id))],
    limit: OPTIONS_MAX,
  });
  return { tasks: rows.filter((o) => canSee(actor, o) && !!o.personal === !!t.personal).map(taskOut) };
}

/** Would "`from` blocks `to`" close a circle? True when `to` already leads, step by step, to `from`. */
async function makesCircle(from, to) {
  const goal = idOf(from);
  const seen = new Set([idOf(to)]);
  let frontier = [to];
  while (frontier.length && seen.size < WALK_MAX) {
    const next = await staffTaskLinkRepository.blockedBy(frontier);
    frontier = [];
    for (const x of next) {
      if (idOf(x) === goal) return true;
      if (!seen.has(idOf(x))) { seen.add(idOf(x)); frontier.push(x); }
    }
  }
  return false;
}

const historyEntry = (actor, action, kind, other) => ({
  at: new Date(), by: actor._id, byName: actor.name || '', action, from: kind, to: `T-${other.number}`,
});
const OPPOSITE = { waiting_on: 'blocking', blocking: 'waiting_on', related: 'related' };

/**
 * Link `id` to `taskId`. Pressing it twice (or a retry) answers as the first did;
 * a different link between the same two tasks is refused.
 */
export async function addLink(actor, id, { kind, taskId } = {}, req) {
  if (!LINK_KINDS.includes(kind)) throw fail('Pick how the tasks are linked.', 400);
  const t = await loadVisible(actor, id);
  if (!canEdit(actor, t)) throw fail('Only whoever gave this task, the team head or the admin can link it.', 403);
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it first.', 409);
  if (idOf(t._id) === String(taskId)) throw fail('A task can’t be linked to itself.', 400);
  const other = await loadVisible(actor, taskId);
  if (other.bucket === 'archived') throw fail('That task is archived. Restore it first.', 409);
  if (!!t.personal !== !!other.personal) throw fail('A personal task can only be linked to your other personal tasks.', 400);

  const [from, to] = kind === 'waiting_on' ? [other._id, t._id] : [t._id, other._id];
  const row = { from, to, kind: kind === 'related' ? 'related' : 'blocks', pair: pairOf(t._id, other._id) };
  const answer = async (existing) => {
    if (existing.kind !== row.kind || idOf(existing.from) !== idOf(from) && row.kind === 'blocks') {
      throw fail('These two tasks are already linked another way. Remove that link first.', 409);
    }
    return listLinks(actor, id);
  };
  const existing = await staffTaskLinkRepository.findPair(row.pair);
  if (existing) return answer(existing);
  if (await staffTaskLinkRepository.countForTask(t._id) >= LINKS_MAX
    || await staffTaskLinkRepository.countForTask(other._id) >= LINKS_MAX) {
    throw fail(`A task can have at most ${LINKS_MAX} links.`, 400);
  }
  if (row.kind === 'blocks' && await makesCircle(from, to)) {
    throw fail('That would leave these tasks waiting on each other, so none could start.', 400);
  }
  try {
    await staffTaskLinkRepository.insert({ ...row, by: actor._id, byName: actor.name || '' });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // The same pair arrived twice at the same moment: the unique index decided.
    const winner = await staffTaskLinkRepository.findPair(row.pair);
    if (winner) return answer(winner);
    throw err;
  }
  await Promise.all([
    staffTaskRepository.noteHistory(t._id, historyEntry(actor, 'link_added', kind, other)),
    staffTaskRepository.noteHistory(other._id, historyEntry(actor, 'link_added', OPPOSITE[kind], t)),
  ]);
  auditLogger.logAction(req, 'UPDATE', 'StaffTask', t._id, { change: 'link_added', kind, other: other.number });
  return listLinks(actor, id);
}

/** Remove a link. A second press finds it gone and is a quiet success. */
export async function removeLink(actor, id, linkId, req) {
  const t = await loadVisible(actor, id);
  if (!mongoose.isValidObjectId(linkId)) throw fail('That link no longer exists.', 404);
  const link = await staffTaskLinkRepository.findById(linkId);
  if (!link) return listLinks(actor, id);
  const otherId = otherEnd(link, t._id);
  if (idOf(link.from) !== idOf(t._id) && idOf(link.to) !== idOf(t._id)) throw fail('That link no longer exists.', 404);
  const other = await staffTaskRepository.findById(otherId);
  if (!canEdit(actor, t) && !(other && canEdit(actor, other))) throw fail('Only whoever gave one of these tasks, the team head or the admin can remove the link.', 403);
  const removed = await staffTaskLinkRepository.remove(link._id);
  if (removed) {
    const kind = kindFrom(link, t._id);
    await Promise.all([
      staffTaskRepository.noteHistory(t._id, historyEntry(actor, 'link_removed', kind, other ?? { number: '?' })),
      ...(other ? [staffTaskRepository.noteHistory(other._id, historyEntry(actor, 'link_removed', OPPOSITE[kind], t))] : []),
    ]);
    auditLogger.logAction(req, 'UPDATE', 'StaffTask', t._id, { change: 'link_removed', kind, other: other?.number });
  }
  return listLinks(actor, id);
}
