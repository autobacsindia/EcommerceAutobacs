/**
 * Start handover: gives what the person leaving still has to the person taking over.
 *
 * Moves: open team tasks, open leads, open quotations (to the replacement, or the
 * team head if none is named) and lessons they look after (to the team head).
 * Stays: personal tasks, finished work, and orders, which are listed only. Moved
 * leads and quotations earn the new person the credit; the moves log keeps who
 * started each one.
 *
 * Nothing moves until a manager presses the button. Each item moves on its own, so
 * one failure never stops the rest. Running again picks up only what is left, and
 * what has moved is no longer theirs, so it cannot move twice.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import repo from '../repositories/staffHandoverRepository.js';
import departures from '../repositories/staffDepartureRepository.js';
import userRepository from '../repositories/userRepository.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import { OPEN_LEAD_STATUSES } from '../config/leadConstants.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { canManageDeparture, canSeeDeparture } from './staffDepartureService.js';
import { peopleOf, updateTask } from './staffTaskService.js';
import { reassignLead } from './teamLeadService.js';

const PER_KIND = 300;
const ORDERS_SHOWN = 50;
const MOVES_SHOWN = 500;
const LOCK_MS = 5 * 60 * 1000;

const fail = (message, status) => new AppError(message, status, { expose: true });
const same = (a, b) => !!a && !!b && String(a) === String(b);
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const sells = (u) => u?.staff?.team === STAFF_TEAMS.SALES && canSell(u);

async function loadManaged(actor, id) {
  const d = await departures.findById(id);
  if (!d || !canSeeDeparture(actor, d)) throw fail('Not found.', 404);
  if (!canManageDeparture(actor, d)) throw fail('Only an admin can do this.', 403);
  return d;
}

/** The replacement, or else the team's head. Null when there is nobody to give it to. */
async function teamHead(d) {
  const team = await userRepository.findActiveStaff(d.team);
  return team.find((u) => u.staff?.isHead === true && !same(u._id, d.user)) ?? null;
}
async function recipientFor(d) {
  if (d.successor) {
    const person = await userRepository.findById(d.successor);
    return isActiveStaff(person) ? person : null;
  }
  return teamHead(d);
}

async function workOf(d) {
  const rep = await salesRepRepository.findByUser(d.user);
  const [tasks, leads, quotations, lessons, orders] = await Promise.all([
    repo.openTasks(d.user, PER_KIND),
    rep ? repo.openLeads(rep._id, OPEN_LEAD_STATUSES, PER_KIND) : [],
    repo.openQuotations(d.user, PER_KIND),
    repo.ownedLessons(d.user, PER_KIND),
    repo.unfinishedOrders(d.user, ORDERS_SHOWN),
  ]);
  return { tasks, leads, quotations, lessons, orders };
}

const labels = {
  task: (t) => `T-${t.number} ${t.title}`,
  lead: (l) => l.name || l.phone || l.email || 'Lead',
  quotation: (q) => `${q.number} ${q.customer?.name || ''}`.trim(),
  lesson: (l) => l.title,
};
const list = (kind, rows) => rows.map((r) => ({ id: String(r._id), label: labels[kind](r) }));
const shapeMove = (m) => ({
  id: String(m._id), kind: m.kind, label: m.label, fromName: m.fromName, toName: m.toName, byName: m.byName, state: m.state, error: m.error, at: m.at,
});

export async function getWork(actor, id) {
  const d = await loadManaged(actor, id);
  return view(d);
}

async function view(d) {
  const [work, to, moves] = await Promise.all([workOf(d), recipientFor(d), repo.movesOf(d._id, MOVES_SHOWN)]);
  return {
    work: {
      tasks: list('task', work.tasks),
      leads: list('lead', work.leads),
      quotations: list('quotation', work.quotations),
      lessons: list('lesson', work.lessons),
      orders: work.orders.map((o) => ({ id: String(o._id), label: `Order ending ${String(o._id).slice(-6).toUpperCase()}`, status: o.status })),
    },
    goesTo: to ? { id: String(to._id), name: to.name || '' } : null,
    canStart: d.status !== 'cancelled',
    moves: moves.map(shapeMove),
  };
}

export async function startHandover(actor, id, req) {
  const d = await loadManaged(actor, id);
  if (d.status === 'cancelled') throw fail('This resignation was cancelled.', 409);
  const to = await recipientFor(d);
  if (!to) throw fail('Name someone active to take over first.', 400);

  const now = new Date();
  if (!await repo.lock(d._id, now, new Date(now.getTime() + LOCK_MS))) throw fail('This handover is already running.', 409);
  const tally = { moved: 0, failed: 0 };
  try {
    const work = await workOf(d);
    const lessonOwner = work.lessons.length ? (await teamHead(d)) ?? actor : null;
    const toRep = (work.leads.length || work.quotations.length) && sells(to) ? await salesRepRepository.findOrCreateForUser(to) : null;

    const one = async (kind, row, receiver, move) => {
      const key = { departure: d._id, kind, ref: row._id };
      await repo.markPending(key, { label: labels[kind](row), fromName: d.userName, to: receiver._id, toName: receiver.name || '', byName: actor.name || '', at: new Date() });
      try {
        await move();
        await repo.settle(key, 'moved');
        tally.moved += 1;
      } catch (err) {
        await repo.settle(key, 'failed', err.expose ? err.message : 'Could not be moved. Please try again.');
        tally.failed += 1;
        if (!err.expose) console.error(`[Handover] ${kind} ${row._id} failed:`, err.message);
      }
    };
    const refuseUnlessSeller = () => { if (!toRep) throw fail(`${to.name} is not a GTM seller, so choose someone who is.`, 400); };

    for (const t of work.tasks) {
      // Others on a shared task stay on it.
      const assigneeIds = [...new Set([...peopleOf(t).map((p) => String(p.user)).filter((x) => x !== String(d.user)), String(to._id)])];
      await one('task', t, to, () => updateTask(actor, t._id, { rev: t.rev, assigneeIds }, req));
    }
    for (const l of work.leads) {
      await one('lead', l, to, async () => {
        refuseUnlessSeller();
        const { outcome } = await reassignLead(actor, l._id, String(to._id));
        if (outcome !== 'reassigned' && outcome !== 'unchanged') throw fail('This lead changed just now.', 409);
      });
    }
    for (const q of work.quotations) {
      await one('quotation', q, to, async () => {
        refuseUnlessSeller();
        if (!await repo.moveQuotation(q._id, d.user, to._id, toRep._id)) throw fail('This quotation changed just now.', 409);
      });
    }
    for (const l of work.lessons) {
      await one('lesson', l, lessonOwner, async () => {
        if (!await repo.moveLesson(l._id, d.user, lessonOwner._id, lessonOwner.name || '')) throw fail('This lesson changed just now.', 409);
      });
    }
  } finally {
    await repo.unlock(d._id);
  }
  auditLogger.logAction(req, 'UPDATE', 'StaffDeparture', d._id, { change: 'handover_started', to: String(to._id), ...tally });
  return { result: tally, ...(await view(d)) };
}
