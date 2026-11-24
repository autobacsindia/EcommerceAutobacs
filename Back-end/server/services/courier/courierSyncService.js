/**
 * Courier tracking sync — read each in-transit parcel's courier tracking and record it.
 *
 * ── WHAT IT WRITES ────────────────────────────────────────────────────────────────
 * Only `shipments[].courierSync` (lastCheckedAt, lastScanAt, lastStatus,
 * noMovementSince, deliveredByCourierAt). The one exception is a final courier
 * "delivered": the parcel is then marked delivered through the EXISTING path,
 * shipmentService.markShipmentDelivered — the same compare-and-set on
 * `status: 'shipped'` staff use, so the customer email/WhatsApp, order roll-up and
 * loyalty effects fire exactly as they always have, and exactly once.
 *
 * ── ONCE-ONLY DELIVERY ────────────────────────────────────────────────────────────
 * Before calling the delivered path we CLAIM the parcel: set
 * `courierSync.deliveredByCourierAt` only where it is still empty and the parcel is
 * still `shipped`. Two runs (two replicas, a cron and the manual script) racing on
 * one parcel → one claim wins → one delivered transition → one customer notice.
 * The claim is released if staff got there first (or the transition failed), so
 * the record only ever says "by courier sync" when the sync actually did it.
 * The claim is KEPT when staff later undo the delivery: a person decided the
 * courier was wrong, so the sync never re-delivers that parcel.
 *
 * ── FAILURES ──────────────────────────────────────────────────────────────────────
 * A timeout, 5xx, network error or unrecognised response leaves the parcel exactly
 * as it was (no write at all); the next run tries again. No retries inside a run —
 * every courier call is a read, but there is still nothing to gain from hammering.
 *
 * ── BOUNDED ───────────────────────────────────────────────────────────────────────
 * Keyset scan over `status: 'shipped'` orders (index {status:1, createdAt:-1}), oldest
 * first, at most `maxParcels` courier calls per run, one at a time with `delayMs`
 * between them, each capped at `timeoutMs`.
 *
 * NO CRON HERE — the follow-up engine wires the schedule (under CronService.withDistributedLock).
 */
import shipmentService from '../shipmentService.js';
import orderRepository from '../../repositories/orderRepository.js';
import courierSyncRepository from '../../repositories/courierSyncRepository.js';
import { refreshWorkflowOpen } from '../teamWorkflowService.js';
import { COURIER_STATUS, courierSyncConfig } from './config.js';
import { resolveTracker, defaultTrackers } from './index.js';

export const COURIER_SYNC_ACTOR = 'Courier sync';

const HOUR = 60 * 60 * 1000;
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`courier did not answer within ${Math.round(ms / 1000)}s`);
        err.code = 'TIMEOUT';
        reject(err);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const VALID = new Set(Object.values(COURIER_STATUS));

/**
 * Pure: what the sync should write for one parcel given the courier's answer.
 * Exported for tests.
 */
export function planParcelUpdate(parcel, result, { now, noMovementHours }) {
  const prev = parcel.courierSync || {};
  const lastScanAt = result.lastScanAt || prev.lastScanAt || null;
  const set = { lastCheckedAt: now, lastStatus: result.status };
  if (result.lastScanAt) set.lastScanAt = result.lastScanAt;

  let noMovementSince = null;
  if (result.status !== COURIER_STATUS.DELIVERED) {
    const ref = lastScanAt || parcel.shippedAt || null;
    if (ref && now - new Date(ref).getTime() >= noMovementHours * HOUR) noMovementSince = new Date(ref);
  }
  return { set, noMovementSince };
}

/**
 * Claim → existing delivered path → record. Returns 'delivered' | 'already' | 'claimed_before' | 'failed'.
 */
async function deliverByCourier(order, parcel, deliveredAt, carrier) {
  const claimAt = deliveredAt || new Date();
  if (!await courierSyncRepository.claimCourierDelivery(order._id, parcel._id, claimAt)) return 'claimed_before';

  const release = () => courierSyncRepository.releaseCourierDelivery(order._id, parcel._id, claimAt).catch((err) => console.error(`[CourierSync] could not release claim on ${order._id}/${parcel._id}:`, err.message));

  let res;
  try {
    res = await shipmentService.markShipmentDelivered(String(order._id), String(parcel._id));
  } catch (err) {
    await release();
    throw err;
  }
  if (!res?.success || res.alreadyDelivered) {
    await release();
    return res?.alreadyDelivered ? 'already' : 'failed';
  }

  // Team-panel history + work queue, as the staff "Delivered" button does.
  if (order.workflow?.enteredAt) {
    const when = deliveredAt ? ` at ${deliveredAt.toISOString()}` : '';
    await orderRepository.pushWorkflowEvent(order._id, {
      at: new Date(),
      byName: COURIER_SYNC_ACTOR,
      team: '',
      action: 'delivered',
      note: `Parcel ${parcel.sequence}: ${carrier} tracking says delivered${when} (by courier sync — undo if wrong)`.slice(0, 500),
    }).catch((err) => console.error(`[CourierSync] history write failed on ${order._id}:`, err.message));
    await refreshWorkflowOpen(String(order._id))
      .catch((err) => console.error(`[CourierSync] queue refresh failed on ${order._id}:`, err.message));
  }
  return 'delivered';
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.apply=true]   false = dry run: call couriers, write nothing, report what would change
 * @param {object}  [opts.trackers]     { dtdc, shiprocket } — injectable for tests
 * @param {object}  [opts.env]
 * @param {() => number} [opts.now]
 * @param {(ms:number) => Promise<void>} [opts.sleepImpl]
 * @param {(line:string) => void} [opts.log]
 * @returns {Promise<object>} summary
 */
export async function runCourierSync({
  apply = true,
  trackers = defaultTrackers(),
  env = process.env,
  now = () => Date.now(),
  sleepImpl = sleep,
  log = () => {},
} = {}) {
  const cfg = courierSyncConfig(env);
  const summary = {
    apply,
    ordersScanned: 0,
    parcelsSeen: 0,
    checked: 0,
    delivered: 0,
    noMovement: 0,
    errors: 0,
    skipped: { no_awb: 0, unknown_courier: 0, not_configured: 0, recently_checked: 0, cap_reached: 0 },
    byCarrier: {},
    changes: [],
  };

  let after = null;
  let calls = 0;
  let capped = false;

  while (!capped) {
    const page = await courierSyncRepository.findInTransitPage(after, Math.min(cfg.pageSize, cfg.maxScanOrders - summary.ordersScanned));
    if (!page.length) break;
    after = { createdAt: page[page.length - 1].createdAt, _id: page[page.length - 1]._id };
    summary.ordersScanned += page.length;

    for (const order of page) {
      for (const parcel of order.shipments || []) {
        if (parcel.status !== 'shipped') continue;
        summary.parcelsSeen += 1;

        const route = resolveTracker(parcel, { trackers, config: cfg });
        const carrierKey = route.carrier || 'unknown';
        summary.byCarrier[carrierKey] = (summary.byCarrier[carrierKey] || 0) + 1;
        if (route.skip) { summary.skipped[route.skip] += 1; continue; }

        const lastChecked = parcel.courierSync?.lastCheckedAt;
        if (lastChecked && now() - new Date(lastChecked).getTime() < cfg.recheckMinutes * 60_000) {
          summary.skipped.recently_checked += 1;
          continue;
        }
        if (calls >= cfg.maxParcels) { capped = true; summary.skipped.cap_reached += 1; continue; }

        if (calls > 0) await sleepImpl(cfg.delayMs);
        calls += 1;
        const label = `#${String(order._id).slice(-8)} parcel ${parcel.sequence} (${carrierKey} ${parcel.trackingNumber})`;

        let result;
        try {
          result = await withTimeout(Promise.resolve().then(() => route.tracker.track(parcel)), cfg.timeoutMs);
          if (!result || !VALID.has(result.status)) throw Object.assign(new Error('unrecognised courier response'), { code: 'BAD_RESPONSE' });
        } catch (err) {
          summary.errors += 1;
          log(`✗ ${label}: ${err.code || 'ERROR'} ${err.message}`);
          continue; // parcel unchanged
        }
        summary.checked += 1;

        const at = new Date(now());
        const plan = planParcelUpdate(parcel, result, { now: at.getTime(), noMovementHours: cfg.noMovementHours });
        plan.set.lastCheckedAt = at;
        if (plan.noMovementSince) summary.noMovement += 1;

        const willDeliver = result.status === COURIER_STATUS.DELIVERED
          && cfg.autoDeliver
          && !parcel.courierSync?.deliveredByCourierAt;
        const change = {
          orderId: String(order._id),
          shipmentId: String(parcel._id),
          sequence: parcel.sequence,
          carrier: carrierKey,
          awb: parcel.trackingNumber,
          from: parcel.courierSync?.lastStatus || null,
          to: result.status,
          lastScanAt: result.lastScanAt || null,
          noMovementSince: plan.noMovementSince,
          markDelivered: willDeliver,
        };
        summary.changes.push(change);
        log(`• ${label}: ${change.from || '—'} → ${result.status}${plan.noMovementSince ? ` · no scan since ${plan.noMovementSince.toISOString()}` : ''}${willDeliver ? ' · MARK DELIVERED' : ''}`);

        if (!apply) continue;
        try {
          await courierSyncRepository.recordCheck(order._id, parcel._id, plan.set, plan.noMovementSince);
          if (willDeliver) {
            const outcome = await deliverByCourier(order, parcel, result.deliveredAt, carrierKey);
            change.outcome = outcome;
            if (outcome === 'delivered') summary.delivered += 1;
          }
        } catch (err) {
          summary.errors += 1;
          log(`✗ ${label}: write failed — ${err.message}`);
        }
      }
      if (capped) break;
    }
    if (page.length < cfg.pageSize) break;
    if (summary.ordersScanned >= cfg.maxScanOrders) { summary.scanCapReached = true; break; }
  }

  return summary;
}

export default runCourierSync;
