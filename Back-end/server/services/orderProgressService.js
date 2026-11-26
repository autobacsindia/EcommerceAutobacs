/**
 * Customer progress updates between "order confirmed" and "shipped" — the ~5 quiet
 * days Herald's "Nothing Extra" notes (2026-11-23) want filled: "customers know where
 * their order is at every stage, without having to ask".
 *
 *   preparing       procurement made a stock decision that moves the item forward
 *                   (teamWorkflowService.setStock → in stock / our warehouse / ordered).
 *   packed          a parcel was built and is waiting for a courier
 *                   (shipmentService.createShipment with dispatch: false, no AWB).
 *   courier_booked  a packed parcel carries a courier + AWB, not yet picked up.
 *   still_on_it     ONE gentle note when a pre-dispatch step runs past N office days
 *                   with no news (config/customerProgress.js) — at most one per step,
 *                   never daily.
 * "Shipped", "out for delivery" and "delivered" already have their own emails
 * (orderStatusEmailService) and are untouched.
 *
 * Every message:
 *   • is keyed like every order email (orderNotificationRules.notificationKey) and
 *     stamped in Order.notifiedStatuses, so a retry, a replayed hook or the sweep
 *     re-finding the same order sends it once;
 *   • is re-checked against the order at send time (stillRelevant): a cancelled or
 *     returned order, an item now shipped, a step already passed → nothing;
 *   • has a WhatsApp twin queued beside it (orderWhatsAppService), which stays silent
 *     until the channel AND that template are switched on.
 * No SMS on purpose: Indian DLT rules need every SMS template registered first.
 *
 * The sweep (runCustomerProgressSweep) is also the backstop for the inline hooks: a
 * stock decision made through another path (split supplier parts, a payment request)
 * or a tracking number added to a packed parcel later is still noticed within one run.
 */
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { enqueueOrderWhatsApp } from './whatsapp/orderWhatsAppService.js';
import { notificationKey, stillRelevant, PROGRESS_EVENTS } from './orderNotificationRules.js';
import { customerJourney, reassuranceStage, createdTimeOf, STEP } from '../utils/customerJourney.js';
import { officeMinutesBetween } from './followUp/officeClock.js';
import { loadCustomerProgressConfig } from '../config/customerProgress.js';

export const PROGRESS_EMAIL_JOB = 'send-order-progress-email';

/** A "preparing" or "packed" message older than this is old news: the sweep will not send it late. */
const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Send one progress email, at most once.
 * @param {string} orderId
 * @param {'preparing'|'packed'|'courier_booked'|'still_on_it'} kind
 * @param {{ shipmentId?: string|null, stage?: string|null }} [opts]
 * @returns {Promise<{status: 'sent'|'off'|'unsupported'|'not-found'|'skipped'|'stale'|'no-recipient'}>}
 * @throws when the provider refuses, so BullMQ retries (nothing is stamped)
 */
export async function emailOrderProgress(orderId, kind, { shipmentId = null, stage = null } = {}) {
  if (!loadCustomerProgressConfig().enabled) return { status: 'off' };
  if (!PROGRESS_EVENTS.has(kind)) return { status: 'unsupported' };

  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email isGuest' }]);
  if (!order) return { status: 'not-found' };

  const key = notificationKey(kind, shipmentId, stage);
  if (order.notifiedStatuses?.includes(key)) return { status: 'skipped' };

  const shipment = shipmentId
    ? (order.shipments || []).find((s) => String(s._id) === String(shipmentId))
    : null;
  if (shipmentId && !shipment) return { status: 'not-found' };
  if (!stillRelevant(order, kind, shipment, stage)) return { status: 'stale' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const to = user?.email || order.guestEmail;
  if (!to) return { status: 'no-recipient' };

  const result = await emailHandler.sendOrderProgress({ to, order, user, kind, shipment, stage });
  if (!result?.success) {
    throw new Error(`Progress email ${key} failed for order ${orderId}: ${result?.error || 'unknown error'}`);
  }
  await orderRepository.addNotifiedStatus(order._id, key);
  return { status: 'sent' };
}

const queueConfigured = () => !!(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL);

/**
 * Queue one progress message on both channels. Best-effort and never throws: a Redis
 * outage must not fail the staff click that triggered it (the sweep re-finds it).
 * Deterministic jobIds, so the inline hook and the sweep queue ONE job between them.
 *
 * @param {string|object} orderId
 * @param {'preparing'|'packed'|'courier_booked'|'still_on_it'} kind
 * @param {{ shipmentId?: string|null, stage?: string|null, delayMs?: number }} [opts]
 */
export function enqueueOrderProgress(orderId, kind, { shipmentId = null, stage = null, delayMs = 0 } = {}) {
  if (!PROGRESS_EVENTS.has(kind) || !queueConfigured()) return null;
  if (!loadCustomerProgressConfig().enabled) return null;
  const id = String(orderId);
  const key = notificationKey(kind, shipmentId ? String(shipmentId) : null, stage);
  try {
    getNotificationsQueue()
      .add(
        PROGRESS_EMAIL_JOB,
        { orderId: id, kind, ...(shipmentId ? { shipmentId: String(shipmentId) } : {}), ...(stage ? { stage } : {}) },
        { jobId: `progress|${id}|${key.replace(/:/g, '|')}`, ...(delayMs > 0 ? { delay: delayMs } : {}) },
      )
      .catch((err) => console.error(`[Progress] Failed to enqueue ${key} for order ${id}:`, err.message));
  } catch (err) {
    console.error(`[Progress] Failed to enqueue ${key} for order ${id}:`, err.message);
  }
  enqueueOrderWhatsApp(id, kind, { shipmentId: shipmentId ? String(shipmentId) : null, occurrence: stage, delayMs });
  return key;
}

/** Inline hook: procurement moved an item forward. Delayed, so an item shipped at once skips it. */
export function onStockDecision(orderId, stock) {
  if (stock === 'out_of_stock') return null;
  return enqueueOrderProgress(orderId, 'preparing', { delayMs: loadCustomerProgressConfig().preparingDelayMs });
}

/** Inline hook: a parcel was built and left packed — "courier booked" when it already has an AWB. */
export function onParcelPacked(orderId, shipment) {
  if (!shipment || shipment.status !== 'packed') return null;
  const kind = String(shipment.trackingNumber || '').trim() ? 'courier_booked' : 'packed';
  return enqueueOrderProgress(orderId, kind, { shipmentId: String(shipment._id) });
}

/**
 * What one order is owed right now — pure, so the sweep's decisions are unit-testable
 * without a queue. Each entry is { kind, shipmentId?, stage? }.
 */
export function dueProgressMessages(order, now, cfg) {
  const journey = customerJourney(order);
  if (!journey || order.status !== 'processing') return [];
  const sent = new Set(order.notifiedStatuses || []);
  const t = now.getTime();
  const out = [];

  // preparing: reached, nothing in a parcel yet, recent, past the short delay.
  const preparing = journey.steps.find((s) => s.key === STEP.PREPARING);
  if (preparing?.done && preparing.at && journey.parcels.total === 0 && !sent.has('preparing')) {
    const age = t - preparing.at.getTime();
    if (age >= cfg.preparingDelayMs && age <= FRESH_MS) out.push({ kind: 'preparing' });
  }

  // packed / courier booked, per parcel still waiting for pickup.
  for (const s of order.shipments || []) {
    if (s?.status !== 'packed') continue;
    const id = String(s._id);
    const age = t - (createdTimeOf(s) ?? t);
    const booked = !!String(s.trackingNumber || '').trim();
    if (booked && !sent.has(notificationKey('courier_booked', id)) && age <= cfg.reassureMaxAgeMs) {
      out.push({ kind: 'courier_booked', shipmentId: id });
    } else if (!booked && !sent.has(notificationKey('packed', id)) && age <= FRESH_MS) {
      out.push({ kind: 'packed', shipmentId: id });
    }
  }

  // still on it: one per step, after N office days on that step with no news.
  const stage = reassuranceStage(journey);
  if (stage && journey.stepStartedAt && !sent.has(notificationKey('still_on_it', null, stage))) {
    const since = journey.stepStartedAt;
    const fresh = t - since.getTime() <= cfg.reassureMaxAgeMs;
    if (fresh && officeMinutesBetween(since, now, cfg.office) >= cfg.reassureAfterMin) {
      out.push({ kind: 'still_on_it', stage });
    }
  }
  return out;
}

/**
 * The sweep: walk processing orders placed within the scan window (newest first,
 * keyset-paged, bounded) and queue whatever each is owed. Run in office time only
 * (cronService), under a distributed lock; the per-message key makes a double run
 * harmless anyway.
 *
 * @returns {Promise<{ scanned: number, queued: number }>}
 */
export async function runCustomerProgressSweep({ now = new Date(), cfg = loadCustomerProgressConfig(), enqueue = enqueueOrderProgress } = {}) {
  if (!cfg.enabled) return { scanned: 0, queued: 0 };
  const since = new Date(now.getTime() - cfg.scanWindowMs);
  let after = null;
  let scanned = 0;
  let queued = 0;
  while (scanned < cfg.maxOrders) {
    const page = await orderRepository.findProgressCandidatesPage({ since, after, limit: cfg.pageSize });
    if (!page.length) break;
    for (const order of page) {
      scanned += 1;
      for (const m of dueProgressMessages(order, now, cfg)) {
        enqueue(order._id, m.kind, { shipmentId: m.shipmentId || null, stage: m.stage || null });
        queued += 1;
      }
    }
    if (page.length < cfg.pageSize) break;
    const last = page[page.length - 1];
    after = { createdAt: last.createdAt, id: last._id };
  }
  if (queued) console.log(`[Progress] Sweep queued ${queued} customer update(s) across ${scanned} order(s)`);
  return { scanned, queued };
}

export default {
  emailOrderProgress, enqueueOrderProgress, onStockDecision, onParcelPacked,
  dueProgressMessages, runCustomerProgressSweep, PROGRESS_EMAIL_JOB,
};
