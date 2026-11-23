/**
 * The follow-up sweep (every 5 minutes in office time, services/cronService.js).
 *
 * One pass:
 *   1. walk the open workflow (keyset on team_workflow_open, bounded by
 *      FOLLOWUP_MAX_ORDERS) and work out every step's deadline and owner
 *   2. a step past its reminder point gets a FollowUpDelay row (unique key, so
 *      replicas / retries share one row); past its deadline the row goes late and
 *      the owner at that moment is frozen
 *   3. each ladder level that is due is CLAIMED on the row (compare-and-set), then
 *      sent through the channels — so a second sweep, a replica or a restart
 *      sends nothing twice
 *   4. open rows whose step is no longer waiting are resolved, and their pop-ups
 *      taken off the panel. Skipped for orders the walk did not reach when it hit
 *      its bound: an unread order is not proof the step moved on.
 *
 * Modes: off → nothing. shadow → everything is computed, recorded and claimed,
 * nothing is sent (levels are recorded with mode 'shadow' and who WOULD have been
 * told). live → sent. Levels claimed in shadow are not re-sent when the mode
 * flips to live, so turning it on does not fire a burst of stale alerts.
 *
 * Never throws: a failed step is logged and retried by the next pass (a level is
 * only marked once its claim was won).
 *
 * TODO(wave 2 / piece B): run courier sync (services/courier runCourierSync())
 * before step 1 so parcel steps see fresh courier scans. Not wired here — piece B
 * owns that export and its schedule decision.
 */
import * as Sentry from '@sentry/node';
import orderRepository from '../../repositories/orderRepository.js';
import followUpDelayRepository from '../../repositories/followUpDelayRepository.js';
import { loadFollowUpConfig } from '../../config/followUp.js';
import { STAGE, STAGE_LABELS } from '../../utils/teamWorkflow.js';
import { formatDateTimeIST } from '../../utils/datetime.js';
import { orderNumber } from '../invoiceService.js';
import { addOfficeMinutes, isOfficeTime } from './officeClock.js';
import { followUpSteps } from './steps.js';
import { loadPeople, resolveOwner, recipientsFor } from './people.js';
import { dispatchAlert, clearAlertsFor } from './channels.js';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const time = (d) => (d ? new Date(d).getTime() : 0);
const HOUR = 3600 * 1000;
const LATE_LEVELS = Object.freeze(['due', 'head', 'admin']);
const RESOLVE_PAGE = 200;

const stageLabel = (stage) => (stage === STAGE.SHIPPED ? 'In transit' : STAGE_LABELS[stage] || stage);
const age = (ms) => {
  const h = Math.max(0, Math.floor(ms / HOUR));
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
};
const sameOwner = (a, b) => idOf(a?.user) === idOf(b?.user) && a?.source === b?.source && (a?.team || '') === (b?.team || '');

/** The alert for one level of one row. */
export function buildAlert(level, row, cycle, recipients, now) {
  const owner = row.ownerAtLate || row.owner;
  const what = [row.itemName, stageLabel(row.stage)].filter(Boolean).join(' · ');
  const title = `${row.orderNumber || 'Order'} · ${stageLabel(row.stage)}`;
  const restarted = time(cycle) > time(row.dueAt);
  let text;
  if (level === 'remind') text = `Due ${formatDateTimeIST(row.dueAt)}. Move it on, or give a reason. ${row.itemName || ''}`;
  else if (level === 'due') {
    text = restarted
      ? `Next follow-up date ${formatDateTimeIST(cycle)} has passed. Move it on, or give a reason. ${row.itemName || ''}`
      : `Was due ${formatDateTimeIST(row.dueAt)}. Move it on, or give a reason and the next date. ${row.itemName || ''}`;
  } else text = `${owner?.name || 'The team'}'s step is ${age(now.getTime() - time(cycle))} late. ${row.itemName || ''}`;
  return {
    level,
    kind: level === 'remind' || level === 'due' ? 'followup_due' : 'followup_escalated',
    delay: row,
    cycle,
    recipients,
    title,
    text: text.trim(),
    push: {
      title: `${level === 'remind' || level === 'due' ? 'Follow-up due' : 'Late follow-up'}: ${row.orderNumber || 'order'}`,
      body: `${what}. ${level === 'head' || level === 'admin' ? `Owner: ${owner?.name || '—'}.` : 'Open the panel to move it on.'}`.trim(),
      tag: `followup-${idOf(row._id)}-${level}`,
    },
  };
}

/** Was `level` already claimed for this cycle? (A read of the prefetched row: no round trip.) */
const claimed = (row, level, cycle) => !!row.levels?.[level] && time(row.levels[level]) === time(cycle);

/**
 * Claim one level (the claim and its record are ONE write), then send (live).
 * Returns 1 when this pass won the claim.
 */
async function fireLevel({ row, level, cycle, people, mode, now, alerted, out, deps }) {
  if (claimed(row, level, cycle)) return 0;
  const owner = row.ownerAtLate || row.owner;
  const recipients = recipientsFor(level, owner, row.team, people).filter((u) => !alerted.has(idOf(u._id)));
  const live = mode === 'live' && recipients.length > 0;
  // `sent` = people it went out to (live); device-level delivery is the channels' concern.
  const entry = { level, cycle, at: now, mode, recipients: recipients.map((u) => u._id), sent: live ? recipients.length : 0 };
  if (!await followUpDelayRepository.claimLevel(row._id, level, cycle, row.pausedUntil, entry)) return 0;
  recipients.forEach((u) => alerted.add(idOf(u._id)));
  if (live) {
    await deps.dispatch(buildAlert(level, row, cycle, recipients, now));
    out.sent += recipients.length;
  }
  out.levels[level] += 1;
  return 1;
}

/** Everything one waiting step needs this pass. `existing` is its row, if any (prefetched). */
async function handleStep(step, order, ctx, existing) {
  const { now, cfg, people, out } = ctx;
  const owner = resolveOwner(step, people);
  let row = existing;
  if (!row) {
    const lateAlready = now.getTime() >= step.dueAt.getTime();
    row = await followUpDelayRepository.ensure(step.key, {
      subject: 'order',
      order: order._id,
      orderNumber: orderNumber(order),
      stage: step.stage,
      team: step.team,
      itemKind: step.itemKind,
      itemId: step.itemId,
      itemName: step.itemName,
      enteredAt: step.enteredAt,
      dueAt: step.dueAt,
      remindAt: step.remindAt,
      owner,
      // Found already past its deadline: born late, owner frozen, in the same write.
      ...(lateAlready ? { lateAt: step.dueAt, ownerAtLate: owner } : {}),
    });
    if (lateAlready && row?.lateAt) out.late += 1;
  }
  if (!row?.open) return;

  if (!row.lateAt && now.getTime() < step.dueAt.getTime()) {
    // Not late yet. A parcel's date can move: keep the deadline in step.
    if (time(row.dueAt) !== step.dueAt.getTime() || time(row.remindAt) !== step.remindAt.getTime() || !sameOwner(row.owner, owner)) {
      row = await followUpDelayRepository.refreshBeforeLate(row._id, { dueAt: step.dueAt, remindAt: step.remindAt, owner }) || row;
    }
    const paused = row.pausedUntil && time(row.pausedUntil) > now.getTime();
    if (!paused && now.getTime() >= step.remindAt.getTime()) {
      // Reminded once per step: the cycle is the step's own start.
      await fireLevel({ ...ctx, row, level: 'remind', cycle: step.enteredAt, alerted: new Set(), deps: ctx.deps });
    }
    return;
  }

  if (!row.lateAt) {
    // It went late at its deadline; the owner AT THAT MOMENT is frozen.
    const lateDue = row.dueAt && time(row.dueAt) <= now.getTime() ? row.dueAt : step.dueAt;
    row = await followUpDelayRepository.markLate(row._id, { lateAt: lateDue, ownerAtLate: owner })
      || await followUpDelayRepository.findById(row._id);
    if (!row?.open) return;
    out.late += 1;
  }

  // The deadline moved later after it went late (a new parcel date): the ladder
  // waits for the new one, then restarts at `due`. The delay itself stays.
  if (step.dueAt.getTime() > time(row.dueAt) && step.dueAt.getTime() > time(row.pausedUntil)) {
    row = await followUpDelayRepository.pauseUntilAtLeast(row._id, step.dueAt) || row;
  }
  if (row.pausedUntil && time(row.pausedUntil) > now.getTime()) { out.paused += 1; return; }

  const cycle = new Date(Math.max(time(row.dueAt), time(row.pausedUntil)));
  const at = {
    due: cycle,
    head: addOfficeMinutes(cycle, cfg.headAfterMin, cfg.office),
    admin: addOfficeMinutes(cycle, cfg.adminAfterMin, cfg.office),
  };
  // Nobody hears twice in one cycle (counting levels sent by earlier passes).
  const alerted = new Set((row.levelsReached || [])
    .filter((r) => time(r.cycle) === cycle.getTime())
    .flatMap((r) => (r.recipients || []).map(idOf)));
  for (const level of LATE_LEVELS) {
    if (now.getTime() < at[level].getTime()) break;
    await fireLevel({ ...ctx, row, level, cycle, alerted, deps: ctx.deps });
  }
}

/** Resolve open rows whose step is no longer waiting. */
async function resolveFinished(ctx, live, scannedOrders, truncated) {
  const { now, out } = ctx;
  let after = null;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await followUpDelayRepository.openPage(after, RESOLVE_PAGE);
    if (!page.length) break;
    for (const row of page) {
      if (live.has(row.key)) continue;
      if (truncated && !scannedOrders.has(idOf(row.order))) continue;
      const done = await followUpDelayRepository.resolve(row._id, now, 'moved_on');
      if (!done) continue;
      out.resolved += 1;
      await clearAlertsFor(done).catch((err) => console.error('[FollowUp] clearing pop-ups failed:', err.message));
    }
    after = page[page.length - 1]._id;
    if (page.length < RESOLVE_PAGE) break;
  }
}

/**
 * One pass. `env` and `deps` are for tests (deps.dispatch replaces the channels).
 * @returns {Promise<object>} counts of what it did
 */
export async function runFollowUpSweep({ now = new Date(), env = process.env, deps = {} } = {}) {
  const cfg = loadFollowUpConfig(env);
  const out = {
    mode: cfg.mode, skipped: null, scanned: 0, steps: 0, late: 0, paused: 0,
    levels: { remind: 0, due: 0, head: 0, admin: 0 }, sent: 0, resolved: 0, failed: 0, truncated: false,
  };
  if (cfg.mode === 'off') { out.skipped = 'off'; return out; }
  // Alerts wait for office time: nobody is woken at night for an order.
  if (!isOfficeTime(now, cfg.office)) { out.skipped = 'outside_office'; return out; }

  try {
    const ctx = {
      now, cfg, mode: cfg.mode, out, people: await (deps.loadPeople || loadPeople)(),
      deps: { dispatch: deps.dispatch || dispatchAlert },
    };
    const live = new Set();
    const scannedOrders = new Set();
    let after = null;
    let lastFull = false;
    let overBudget = false;
    const started = Date.now();
    while (out.scanned < cfg.maxOrders) {
      const limit = Math.min(cfg.pageSize, cfg.maxOrders - out.scanned);
      const page = await orderRepository.findOpenWorkflowPage({ after, limit });
      if (!page.length) { lastFull = false; break; }
      // One read for every row this page's due steps already have.
      const due = [];
      for (const order of page) {
        scannedOrders.add(idOf(order._id));
        for (const step of followUpSteps(order, cfg)) {
          live.add(step.key);
          out.steps += 1;
          if (now.getTime() >= step.remindAt.getTime()) due.push({ step, order });
        }
      }
      const existing = new Map((await followUpDelayRepository.findByKeys(due.map((d) => d.step.key))).map((r) => [r.key, r]));
      for (const { step, order } of due) {
        try {
          await handleStep(step, order, ctx, existing.get(step.key));
        } catch (err) {
          out.failed += 1;
          console.error(`[FollowUp] step ${step.key} failed:`, err.message);
          Sentry.captureException(err);
        }
      }
      out.scanned += page.length;
      lastFull = page.length === limit;
      const last = page[page.length - 1];
      after = { enteredAt: last.workflow.enteredAt, id: last._id };
      if (!lastFull) break;
      // Stay well inside the cron lock: the rest waits for the next pass.
      if (Date.now() - started > cfg.passBudgetMs) { overBudget = true; break; }
    }
    out.truncated = overBudget || (out.scanned >= cfg.maxOrders && lastFull);
    if (out.truncated) console.warn(`[FollowUp] stopped after ${out.scanned} open orders (${overBudget ? 'time budget' : 'FOLLOWUP_MAX_ORDERS'}) — the rest wait for the next pass`);
    await resolveFinished(ctx, live, scannedOrders, out.truncated);
  } catch (err) {
    out.failed += 1;
    console.error('[FollowUp] sweep failed:', err.message);
    Sentry.captureException(err);
  }
  return out;
}
