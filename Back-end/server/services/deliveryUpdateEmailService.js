/**
 * "Your delivery details were updated" — the customer email sent when staff correct a
 * parcel's tracking number or courier AFTER it has shipped.
 *
 * The shipped email already told the customer a tracking number and courier. When the
 * team corrects either, the website shows the new values but nobody tells the customer,
 * who keeps tracking the wrong AWB. This closes that gap.
 *
 * ── WHAT COUNTS AS A CHANGE ──────────────────────────────────────────────────────
 * Only what the customer sees: tracking number, courier name and the courier's tracking
 * link (shown only when it is for the CURRENT number — a link built for the old AWB is
 * dropped rather than sent). No delivery date: the shipped email deliberately promises
 * none (utils/emailTemplates.js), and the panel's ETA is the team's own working date.
 *
 * ── ONE EMAIL PER REAL CORRECTION ────────────────────────────────────────────────
 * Each parcel records a hash of the details the customer was last emailed
 * (`deliveryNotice.hash` — set by the shipped email and by this one). A job whose
 * current details hash the same sends nothing, so a double-save, a queue retry, or an
 * edit undone before the email went out all send nothing. A genuinely new value has a
 * new hash and sends again.
 *
 * ── AT MOST ONE PER PARCEL PER 10 MINUTES ────────────────────────────────────────
 * Every edit enqueues a job after a short settle delay, and the job reads the LATEST
 * values from the database, so a burst of edits collapses into one email. If the
 * customer was emailed less than RATE_WINDOW_MS ago the job re-queues itself for the
 * end of that window under a deterministic job id, so all edits inside one window
 * collapse into a single follow-up.
 *
 * ── TWO WORKERS AT ONCE ──────────────────────────────────────────────────────────
 * The send is guarded by an atomic claim (a short lease on the parcel). The loser of a
 * race re-queues itself instead of sending; a lease left by a crashed worker expires.
 */

import crypto from 'node:crypto';
import orderRepository from '../repositories/orderRepository.js';
import emailHandler from './emailHandler.js';
import { isInternalEmail } from '../utils/customerContact.js';
// Namespace import, resolved at call time: the order-tracking and team-panel services
// import this module, and many of their tests stub queues.js with a partial mock.
import * as queues from '../queue/queues.js';

export const JOB_NAME = 'send-delivery-update-email';
/** Wait this long after an edit, so quick back-to-back fixes become one email. */
export const SETTLE_MS = 2 * 60 * 1000;
/** At most one delivery-update email per parcel in this window. */
export const RATE_WINDOW_MS = 10 * 60 * 1000;
/** A claim older than this belongs to a worker that died mid-send. */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
/** How long to wait for a still-pending shipped email before sending the update anyway. */
export const SHIPPED_EMAIL_GRACE_MS = 60 * 60 * 1000;
/** Try again this soon when another worker holds the claim. */
const BUSY_RETRY_MS = 60 * 1000;

const SHIPPED = 'shipped';
const clean = (v) => String(v ?? '').trim();

/**
 * The delivery details the customer sees for a parcel (or a legacy parcel-less order).
 * The courier link is kept only when it is for the current tracking number.
 */
export function customerDeliveryDetails(src = {}) {
  const trackingNumber = clean(src.trackingNumber);
  const courier = clean(src.carrier?.name);
  const url = clean(src.carrier?.trackingUrl);
  const courierUrl = trackingNumber && url.includes(trackingNumber) ? url : '';
  return { trackingNumber, courier, courierUrl };
}

/** Stable fingerprint of what the customer was (or would be) told. */
export function deliveryDetailsHash(details) {
  const d = customerDeliveryDetails({
    trackingNumber: details.trackingNumber,
    carrier: { name: details.courier, trackingUrl: details.courierUrl },
  });
  return crypto.createHash('sha256')
    .update(JSON.stringify([d.trackingNumber, d.courier, d.courierUrl]))
    .digest('hex')
    .slice(0, 24);
}

/** Hash straight from a parcel / order document. */
export const hashOf = (src) => deliveryDetailsHash(customerDeliveryDetails(src));

/** Did an edit change anything the customer sees? */
export const customerVisibleChange = (before, after) => hashOf(before) !== hashOf(after);

/**
 * Queue the email after a correction. Best-effort: a queue outage must never fail the
 * staff member's save — the edit stands and the failure is logged.
 * @param {string} orderId
 * @param {string|null} shipmentId - null for a legacy order shipped without parcels
 */
export function enqueueDeliveryUpdateEmail(orderId, shipmentId = null, { delay = SETTLE_MS, jobId } = {}) {
  if (!process.env.REDIS_URL) return Promise.resolve();
  const data = { orderId: String(orderId), shipmentId: shipmentId ? String(shipmentId) : null };
  return Promise.resolve()
    .then(() => queues.getNotificationsQueue().add(JOB_NAME, data, { delay, ...(jobId && { jobId }) }))
    .catch((err) =>
      console.error(`[DeliveryUpdate] Failed to enqueue for order ${orderId} parcel ${shipmentId || '-'}:`, err.message));
}

/**
 * Worker body for JOB_NAME. Never throws for a "nothing to send" outcome; throws only
 * on a retryable provider failure, so BullMQ retries it.
 *
 * @returns {Promise<{status: 'sent'|'unchanged'|'rescheduled'|'busy'|'not-in-transit'
 *   |'no-recipient'|'not-found'|'not-sent'}>}
 */
export async function emailDeliveryUpdate(orderId, shipmentId = null, { now = Date.now() } = {}) {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  // The parcel this is about — or the order itself for a legacy parcel-less shipment.
  let src;
  if (shipmentId) {
    src = (order.shipments || []).find((s) => String(s._id) === String(shipmentId));
    if (!src) return { status: 'not-found' };
    if (src.status !== SHIPPED) return { status: 'not-in-transit' }; // packed, delivered, lost
  } else {
    if (order.status !== SHIPPED || (order.shipments || []).length) return { status: 'not-in-transit' };
    src = order;
  }

  const details = customerDeliveryDetails(src);
  if (!details.trackingNumber && !details.courier) return { status: 'unchanged' };
  const hash = deliveryDetailsHash(details);
  const notice = src.deliveryNotice || {};
  if (notice.hash === hash) return { status: 'unchanged' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const to = clean(user?.email || order.guestEmail);
  // A phone-only customer carries a placeholder `.invalid` address: no mailbox behind it.
  if (!to || isInternalEmail(to)) {
    console.warn(`[DeliveryUpdate] No customer email on order ${orderId} — not sent`);
    return { status: 'no-recipient' };
  }

  // The shipped email has not gone out yet (still queued or retrying) — it will carry
  // the latest details itself, so a separate "update" now would be a second email for
  // one dispatch. Look again after the window; the shipped email records its hash.
  const shippedKey = shipmentId ? `shipped:${shipmentId}` : 'shipped';
  const shippedAt = new Date(src.shippedAt || order.shippedAt || 0).getTime();
  if (!notice.sentAt && !(order.notifiedStatuses || []).includes(shippedKey)
      && shippedAt && now - shippedAt < SHIPPED_EMAIL_GRACE_MS) {
    const windowEnd = shippedAt + RATE_WINDOW_MS * Math.ceil((now - shippedAt + 1) / RATE_WINDOW_MS);
    await enqueueDeliveryUpdateEmail(orderId, shipmentId, {
      delay: windowEnd - now,
      jobId: `delivery-update-${orderId}-${shipmentId || 'order'}-${windowEnd}`,
    });
    return { status: 'rescheduled' };
  }

  // Rate guard: one email per parcel per window. Re-queue for the window's end under a
  // fixed id, so every edit inside this window collapses into that one follow-up.
  const lastSent = notice.sentAt ? new Date(notice.sentAt).getTime() : 0;
  if (lastSent && now - lastSent < RATE_WINDOW_MS) {
    const windowEnd = lastSent + RATE_WINDOW_MS;
    await enqueueDeliveryUpdateEmail(orderId, shipmentId, {
      delay: windowEnd - now,
      jobId: `delivery-update-${orderId}-${shipmentId || 'order'}-${windowEnd}`,
    });
    return { status: 'rescheduled' };
  }

  // Claim: only one worker may send for this parcel at a time.
  const claimed = await orderRepository.updateDeliveryNoticeIf(order._id, shipmentId, {
    hash: { $ne: hash },
    $or: [{ claimedAt: null }, { claimedAt: { $lt: new Date(now - CLAIM_LEASE_MS) } }],
  }, { set: { claimHash: hash, claimedAt: new Date(now) } });
  if (!claimed) {
    // Someone else is sending (or just sent). Look again shortly: if they sent older
    // values, this run's newer ones still go out.
    await enqueueDeliveryUpdateEmail(orderId, shipmentId, { delay: BUSY_RETRY_MS });
    return { status: 'busy' };
  }

  const release = () => orderRepository.updateDeliveryNoticeIf(order._id, shipmentId,
    { claimHash: hash }, { unset: { claimHash: '', claimedAt: '' } });

  let result;
  try {
    result = await emailHandler.sendDeliveryUpdate({ to, order, user, shipment: shipmentId ? src : null, details });
  } catch (err) {
    await release();
    throw err;
  }

  if (result?.success) {
    await orderRepository.updateDeliveryNoticeIf(order._id, shipmentId, { claimHash: hash }, {
      set: { hash, sentAt: new Date(now) },
      unset: { claimHash: '', claimedAt: '' },
    });
    return { status: 'sent' };
  }

  await release();
  if (result?.retryable === false || result?.skipped) {
    console.warn(`[DeliveryUpdate] Not sent for order ${orderId}: ${result?.error || 'refused'}`);
    return { status: 'not-sent' };
  }
  throw new Error(`Delivery update email failed for order ${orderId} (${shipmentId || 'order'}): ${result?.error || 'unknown error'}`);
}

export default { emailDeliveryUpdate, enqueueDeliveryUpdateEmail, customerVisibleChange, hashOf };
