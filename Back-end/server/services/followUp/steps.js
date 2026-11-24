/**
 * What an open order is waiting on, step by step, with each step's deadline and
 * the person who put it there. Pure: no I/O, no clock.
 *
 * A step = one order line in one team stage, or one parcel in transit. (The chat
 * digest's waitingOn() groups lines per stage; the engine needs each line, since
 * each line has its own owner and its own delay record.)
 *
 * ── When did the step start, and whose is it? ───────────────────────────────
 * The latest workflow history entry for THAT line that moves it (stock decision,
 * payment raised/paid, customer decision, refund…). Entries that only annotate a
 * line (a supplier part edited, accounts' review of a supplier change, a refund
 * send attempt) are skipped, so a later note by someone else neither restarts the
 * clock nor makes them the owner. No entry → the moment the order entered the
 * workflow, with no mover (the system put it there) → the team head.
 *
 * Parcels start when they shipped; their person is whoever set the expected
 * date, else whoever dispatched them.
 */
import { workflowView, STAGE, STAGE_TEAM } from '../../utils/teamWorkflow.js';
import { SHIPMENT_STATUS } from '../../utils/orderFulfilment.js';
import { addDays, parseEtaDay } from '../../utils/parcelEta.js';
import { addOfficeMinutes, officeMinutesBetween, snapToOffice } from './officeClock.js';

/** History actions that annotate a line without moving it to another stage. */
export const NON_MOVING_ACTIONS = Object.freeze(new Set([
  'part_edited', 'supplier_change_approved', 'supplier_change_rejected',
  'refund_sent', 'refund_send_failed', 'refund_approval_failed',
  'eta_set', 'overdue_reason_set', 'parcel_step', 'dispatch_edited',
]));

/** The team that follows a parcel in transit (not a line stage, so not in STAGE_TEAM). */
export const TRANSIT_TEAM = 'operations';
/** Teams whose person may own a parcel (procurement dispatches its own stock). */
const PARCEL_TEAMS = Object.freeze(['operations', 'procurement']);

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** `order:<orderId>:<stage>:<itemOrParcelId>:<enteredAt ms>` — one step, forever. */
export const stepKey = (orderId, stage, itemId, enteredAt) => `order:${idOf(orderId)}:${stage}:${idOf(itemId)}:${new Date(enteredAt).getTime()}`;

/** Per line: the latest history entry that moved it. */
function movesByLine(order) {
  const last = new Map();
  for (const e of order.workflow?.history || []) {
    if (!e?.itemId || !e.at || NON_MOVING_ACTIONS.has(e.action)) continue;
    const id = idOf(e.itemId);
    const prev = last.get(id);
    if (!prev || new Date(e.at).getTime() >= new Date(prev.at).getTime()) last.set(id, e);
  }
  return last;
}

const mover = (e) => (e?.by ? { user: idOf(e.by), name: e.byName || '', team: e.team || '' } : null);

/** End of the parcel's expected day (IST) + grace calendar days, snapped into office time. */
function parcelDue(parcel, enteredAt, cfg) {
  const day = parseEtaDay(parcel.eta?.day);
  if (!day) return addOfficeMinutes(enteredAt, cfg.sla[STAGE.SHIPPED], cfg.office);
  // 'YYYY-MM-DD'T18:30Z is midnight IST at the END of that India day.
  const end = Date.parse(`${addDays(day, cfg.parcelGraceDays)}T18:30:00Z`);
  return snapToOffice(new Date(end), cfg.office);
}

/**
 * Every step `order` is waiting on: [{ key, stage, team, acceptTeams, itemKind,
 * itemId, itemName, enteredAt, dueAt, remindAt, candidate }]. `candidate` is the
 * person the history names ({ user, name, team }) or null.
 */
export function followUpSteps(order, cfg) {
  const view = workflowView(order);
  if (!view) return [];
  const orderId = idOf(order._id);
  const entered = new Date(order.workflow.enteredAt);
  const moves = movesByLine(order);
  const names = new Map((order.items || []).map((i) => [idOf(i._id), i.name || '']));
  const steps = [];

  for (const line of view.lines) {
    const team = STAGE_TEAM[line.stage];
    if (!team) continue;
    const move = moves.get(line.itemId);
    const enteredAt = move ? new Date(move.at) : entered;
    const sla = cfg.sla[line.stage];
    steps.push({
      key: stepKey(orderId, line.stage, line.itemId, enteredAt),
      stage: line.stage,
      team,
      acceptTeams: [team],
      itemKind: 'line',
      itemId: line.itemId,
      itemName: names.get(line.itemId) || '',
      enteredAt,
      dueAt: addOfficeMinutes(enteredAt, sla, cfg.office),
      remindAt: addOfficeMinutes(enteredAt, Math.round(sla * cfg.remindFraction), cfg.office),
      candidate: mover(move),
    });
  }

  for (const id of view.inTransitShipmentIds) {
    const parcel = (order.shipments || []).find((s) => idOf(s._id) === id);
    if (parcel?.status !== SHIPMENT_STATUS.SHIPPED) continue;
    const enteredAt = new Date(parcel.shippedAt || parcel.createdAt || entered);
    const dueAt = parcelDue(parcel, enteredAt, cfg);
    const span = officeMinutesBetween(enteredAt, dueAt, cfg.office);
    const who = parcel.eta?.setBy
      ? { user: idOf(parcel.eta.setBy), name: parcel.eta.setByName || '', team: parcel.eta.setByTeam || '' }
      : parcel.createdBy ? { user: idOf(parcel.createdBy), name: '', team: '' } : null;
    steps.push({
      key: stepKey(orderId, STAGE.SHIPPED, id, enteredAt),
      stage: STAGE.SHIPPED,
      team: TRANSIT_TEAM,
      acceptTeams: PARCEL_TEAMS,
      itemKind: 'parcel',
      itemId: id,
      itemName: `Parcel ${parcel.sequence ?? ''}`.trim(),
      enteredAt,
      dueAt,
      remindAt: addOfficeMinutes(enteredAt, Math.round(span * cfg.remindFraction), cfg.office),
      candidate: who,
    });
  }
  return steps;
}
