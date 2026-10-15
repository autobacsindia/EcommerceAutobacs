/**
 * Team activity — the admin's view of the order workflow: what is waiting now,
 * how each order moved, and which team (and person) took how long.
 *
 * READ-ONLY. Everything here is derived from what the workflow already records:
 * `order.workflow.history` (every team action: who, when, which item) and the
 * stage rules in utils/teamWorkflow.js. Nothing is written, so this page cannot
 * change how any team works.
 *
 * ── HOW A DELAY IS MEASURED ─────────────────────────────────────────────────────
 * Each item line is always waiting on one stage, and each stage belongs to one
 * team (STAGE_TEAM). When an action moves the line on, the time since the line
 * reached that stage is the wait — charged to the team that owned the stage, and
 * credited to the person who acted. A wait past the stage's threshold (the same
 * STUCK_AFTER_HOURS the morning digest uses) is "late".
 *
 * Limits: the timeline reflects team-panel actions. Shipments or deliveries an
 * admin records from the admin panel move the order without a history entry, so
 * they appear as the line reaching that state, not as a person's action.
 */
import AppError from '../utils/AppError.js';
import orderRepository from '../repositories/orderRepository.js';
import { orderNumber } from './invoiceService.js';
import { waitingOn, STUCK_AFTER_HOURS } from './chatStuckDigest.js';
import { STAGE, STAGE_LABELS, STAGE_TEAM } from '../utils/teamWorkflow.js';
import { STAFF_TEAM_LABELS } from '../config/staff.js';
import { variantDisplayName } from '../utils/orderLines.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const HOUR = 3600 * 1000;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

const BOARD_MAX = 1000;
const PERFORMANCE_MAX_ORDERS = 3000;
const DONE = 'done';

/** The team that owns a stage ('operations' for a parcel in transit). */
const teamOf = (stage) => (stage === STAGE.SHIPPED ? 'operations' : STAGE_TEAM[stage] || null);
const thresholdMs = (stage) => (STUCK_AFTER_HOURS[stage] ? STUCK_AFTER_HOURS[stage] * HOUR : null);

/** What each recorded action does to the line it names. */
const NEXT_STAGE = Object.freeze({
  stock_in_stock: STAGE.TO_SHIP,
  stock_ordered: STAGE.WITH_SUPPLIER,
  stock_out_of_stock: STAGE.CUSTOMER_DECISION,
  customer_waits: STAGE.STOCK_CHECK,
  refund_requested: STAGE.ACCOUNTS_APPROVAL,
  refund_rejected: STAGE.CUSTOMER_DECISION,
  refund_approved: DONE,
});

export const ACTION_LABELS = Object.freeze({
  entered: 'Paid — entered the workflow',
  stock_in_stock: 'Marked in stock',
  stock_ordered: 'Ordered from supplier',
  stock_out_of_stock: 'Marked out of stock',
  payment_initiated: 'Supplier payment started',
  payment_undone: 'Supplier payment mark removed',
  shipped: 'Shipped (supplier proof uploaded)',
  customer_waits: 'Customer will wait',
  refund_requested: 'Customer wants a refund',
  refund_rejected: 'Refund sent back to sales',
  refund_approval_failed: 'Refund approval failed',
  refund_approved: 'Refund approved',
  delivered: 'Delivered',
});

function assertAdmin(actor) {
  if (actor?.role !== 'admin') throw fail('Not authorized.', 403);
}

const itemNameOf = (order, itemId) => {
  const it = (order.items || []).find((i) => idOf(i._id) === idOf(itemId));
  return it ? variantDisplayName(it.name, it.variantLabel) : null;
};

/** Who a waiting stage is on: the seller for a sales decision, else the team. */
function waitingFor(order, team) {
  if (team === 'sales' && order.salesUser) return order.salesUser.name || 'The seller';
  if (team === 'sales') return 'Sales heads (website order)';
  return `${STAFF_TEAM_LABELS[team] || team} team`;
}

/**
 * One order's history as steps, each with how long the line had been waiting
 * and on whom. Pure.
 */
export function buildTimeline(order) {
  const enteredAt = order.workflow?.enteredAt ? new Date(order.workflow.enteredAt).getTime() : null;
  if (!enteredAt) return [];

  // Every line starts at stock check the moment the order is paid.
  const lines = new Map((order.workflow.lines || []).map((l) => [idOf(l.itemId), { stage: STAGE.STOCK_CHECK, since: enteredAt }]));
  const events = (order.workflow.history || [])
    .filter((e) => e?.at && e.action !== 'entered')
    .map((e) => ({ ...e, t: new Date(e.at).getTime() }))
    .sort((a, b) => a.t - b.t);

  const steps = [{
    at: new Date(enteredAt), action: 'entered', label: ACTION_LABELS.entered,
    by: null, byTeam: null, item: null, note: null, waited: null,
  }];

  for (const e of events) {
    const base = {
      at: new Date(e.t),
      action: e.action,
      label: ACTION_LABELS[e.action] || e.action,
      by: e.byName || null,
      byId: e.by ? idOf(e.by) : null,
      byTeam: e.team || null,
      item: e.itemId ? itemNameOf(order, e.itemId) : null,
      note: e.note || null,
      waited: null,
    };

    // The lines this action moves on, and where they go.
    let affected = [];
    let next = null;
    if (e.itemId && lines.has(idOf(e.itemId)) && NEXT_STAGE[e.action]) {
      affected = [idOf(e.itemId)];
      next = NEXT_STAGE[e.action];
    } else if (e.action === 'shipped') {
      affected = [...lines].filter(([, l]) => l.stage === STAGE.TO_SHIP || l.stage === STAGE.WITH_SUPPLIER).map(([id]) => id);
      next = STAGE.SHIPPED;
    } else if (e.action === 'delivered') {
      affected = [...lines].filter(([, l]) => l.stage === STAGE.SHIPPED).map(([id]) => id);
      next = DONE;
    }

    if (affected.length) {
      // The wait ends here for the line that waited longest.
      const longest = affected.map((id) => lines.get(id)).reduce((a, b) => (a.since <= b.since ? a : b));
      const ms = Math.max(0, e.t - longest.since);
      const limit = thresholdMs(longest.stage);
      base.waited = {
        ms,
        stage: longest.stage,
        stageLabel: longest.stage === STAGE.SHIPPED ? 'In transit' : STAGE_LABELS[longest.stage],
        team: teamOf(longest.stage),
        late: limit != null && ms > limit,
        limitHours: limit != null ? limit / HOUR : null,
      };
      for (const id of affected) lines.set(id, { stage: next, since: e.t });
    }
    steps.push(base);
  }
  return steps;
}

// ── Board: what is waiting now ─────────────────────────────────────────────────

export async function waitingBoard(actor, now = Date.now()) {
  assertAdmin(actor);
  const rows = [];
  let after = null;
  let scanned = 0;
  while (scanned < BOARD_MAX) {
    const page = await orderRepository.findOpenWorkflowPage({ after, limit: 100 });
    if (!page.length) break;
    for (const order of page) {
      for (const w of waitingOn(order)) {
        const limit = thresholdMs(w.stage);
        rows.push({
          orderId: idOf(order._id),
          orderNumber: orderNumber(order),
          customer: order.shippingAddress?.fullName || order.user?.name || '',
          totalAmount: order.totalAmount,
          source: order.salesUser ? 'sales' : 'website',
          seller: order.salesUser?.name || null,
          stage: w.stage,
          stageLabel: w.stage === STAGE.SHIPPED ? 'In transit' : STAGE_LABELS[w.stage],
          team: w.team,
          waitingFor: waitingFor(order, w.team),
          since: new Date(w.since),
          waitingHours: Math.floor((now - w.since) / HOUR),
          limitHours: limit != null ? limit / HOUR : null,
          overdue: limit != null && now - w.since > limit,
        });
      }
    }
    scanned += page.length;
    const last = page[page.length - 1];
    after = { enteredAt: last.workflow.enteredAt, id: last._id };
    if (page.length < 100) break;
  }
  // Most overdue first: how far past its limit, then how long.
  rows.sort((a, b) => (b.waitingHours - (b.limitHours ?? 0)) - (a.waitingHours - (a.limitHours ?? 0)));
  const byTeam = {};
  for (const r of rows) {
    byTeam[r.team] ??= { team: r.team, waiting: 0, overdue: 0 };
    byTeam[r.team].waiting += 1;
    if (r.overdue) byTeam[r.team].overdue += 1;
  }
  return { rows, teams: Object.values(byTeam), truncated: scanned >= BOARD_MAX };
}

// ── One order's timeline ──────────────────────────────────────────────────────

export async function orderTimeline(actor, orderId) {
  assertAdmin(actor);
  const order = await orderRepository.findForWorkflow(orderId);
  if (!order) throw fail('Order not found.', 404);
  if (!order.workflow?.enteredAt) throw fail('This order never entered the team workflow.', 404);
  return {
    orderId: idOf(order._id),
    orderNumber: orderNumber(order),
    customer: order.shippingAddress?.fullName || order.user?.name || '',
    seller: order.salesUser?.name || null,
    status: order.status,
    totalAmount: order.totalAmount,
    steps: buildTimeline(order),
    waitingNow: waitingOn(order).map((w) => ({
      stage: w.stage,
      stageLabel: w.stage === STAGE.SHIPPED ? 'In transit' : STAGE_LABELS[w.stage],
      team: w.team,
      waitingFor: waitingFor(order, w.team),
      since: new Date(w.since),
    })),
  };
}

// ── Performance over a period ─────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pure: aggregate many orders' timelines into per-team and per-person numbers. */
export function summarisePerformance(orders) {
  const teams = new Map();
  const people = new Map();
  for (const order of orders) {
    for (const step of buildTimeline(order)) {
      if (!step.waited?.team) continue;
      const { team, ms, late } = step.waited;
      if (!teams.has(team)) teams.set(team, { team, steps: 0, late: 0, waits: [] });
      const t = teams.get(team);
      t.steps += 1; t.waits.push(ms); if (late) t.late += 1;

      // Credit the person who moved it — only when they belong to the team that
      // owned the wait (an admin stepping in is shown separately as "Admin").
      const key = step.byTeam === 'admin' ? 'admin' : step.byId;
      if (!key || (step.byTeam !== team && step.byTeam !== 'admin')) continue;
      if (!people.has(key)) {
        people.set(key, { id: key, name: step.byTeam === 'admin' ? 'Admin' : (step.by || 'Former member'), team: step.byTeam, steps: 0, late: 0, waits: [] });
      }
      const p = people.get(key);
      p.steps += 1; p.waits.push(ms); if (late) p.late += 1;
    }
  }
  const finish = ({ waits, ...rest }) => ({
    ...rest,
    medianHours: waits.length ? Math.round((median(waits) / HOUR) * 10) / 10 : null,
    lateShare: rest.steps ? Math.round((rest.late / rest.steps) * 100) : 0,
  });
  return {
    teams: [...teams.values()].map(finish).sort((a, b) => b.late - a.late || a.team.localeCompare(b.team)),
    people: [...people.values()].map(finish).sort((a, b) => b.late - a.late || b.steps - a.steps),
  };
}

export async function teamPerformance(actor, { days = 30 } = {}, now = Date.now()) {
  assertAdmin(actor);
  const span = Math.min(Math.max(parseInt(days, 10) || 30, 1), 180);
  const since = new Date(now - span * 24 * HOUR);
  const orders = await orderRepository.findWorkflowOrdersSince(since, PERFORMANCE_MAX_ORDERS);
  return {
    days: span,
    orders: orders.length,
    truncated: orders.length >= PERFORMANCE_MAX_ORDERS,
    ...summarisePerformance(orders),
  };
}
