/**
 * WhatsApp order updates — the WhatsApp twin of orderStatusEmailService.
 *
 * Every customer order email (confirmed, shipped, out for delivery, missed delivery,
 * delivered, cancelled, payment failed, refund started, refund processed) has a
 * WhatsApp message enqueued BESIDE it, as its own `send-order-whatsapp` job. Separate
 * jobs on purpose: a WhatsApp failure never retries, delays or blocks the email, and
 * an email failure never re-sends the WhatsApp message.
 *
 * Sent only when ALL of these hold, checked by the worker at send time:
 *   • the channel is configured (config/whatsapp.js) — otherwise a silent no-op;
 *   • the customer said yes for this order (Order.whatsappOptIn === true);
 *   • the delivery phone is a valid Indian mobile (utils/identity.toE164India);
 *   • the message is still true (stillRelevant — the same rule the email uses);
 *   • it has not been sent before (Order.whatsappNotified, same keys as the email).
 *
 * Idempotency is CLAIM-FIRST: the key is added to whatsappNotified atomically before
 * the send, and given back if the send fails transiently. That makes two concurrent
 * jobs for the same event send once. The cost: a worker that dies between the claim
 * and the send loses that one message — chosen over the alternative (a duplicate
 * WhatsApp message on every lost response), and the email still went out.
 */

import orderRepository from '../../repositories/orderRepository.js';
import notificationLogRepository from '../../repositories/notificationLogRepository.js';
// Namespace import: this module is pulled in by many services, and a test that stubs
// the queue module with only the one export it needs must not fail to load here.
import * as queues from '../../queue/queues.js';
import { getWhatsAppConfig } from '../../config/whatsapp.js';
import { cancellationReasonLabel } from '../../config/cancellationReasons.js';
import { toE164India } from '../../utils/identity.js';
import { storefrontOrigin, trackOrderUrl } from '../../utils/storefrontUrl.js';
import { notificationKey, stillRelevant, paymentFailedEmailDelayMs } from '../orderNotificationRules.js';
import { sendTemplateMessage } from './whatsappClient.js';
import { STILL_ON_IT_LINES } from '../../utils/orderProgressEmail.js';

export const WHATSAPP_JOB = 'send-order-whatsapp';

/** Our event → NotificationLog.event. */
const LOG_EVENT = {
  confirmed: 'order_confirmed',
  shipped: 'order_shipped',
  out_for_delivery: 'order_out_for_delivery',
  delivery_failed: 'order_delivery_failed',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
  payment_failed: 'payment_failed',
  refund_initiated: 'refund_started',
  refunded: 'refund_processed',
  // Progress milestones (services/orderProgressService.js). Sent only once their
  // template is approved at Meta and named in Railway — see config/whatsapp.js.
  preparing: 'order_preparing',
  packed: 'order_packed',
  courier_booked: 'order_courier_booked',
  still_on_it: 'order_still_on_it',
};

export const WHATSAPP_EVENTS = new Set(Object.keys(LOG_EVENT));

/** The customer-facing order reference used in every email and message. */
export const orderRef = (order) => `AB-${String(order._id).slice(-8).toUpperCase()}`;

/** 1,234 or 1,234.50 — the template already prints the ₹. */
export const formatAmount = (n) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "Changed my mind" from a reason code; free text passes through. */
const cancelReason = (order) => {
  const label = cancellationReasonLabel(order.cancellationReason);
  return label || 'Not stated';
};

/**
 * The body variables {{1}}…{{n}} for an event's template, in order — or null when a
 * link the template needs cannot be built (FRONTEND_URL unset), in which case nothing
 * is sent rather than a message with a hole in it.
 *
 * Kept in step with the template wording handed to the owner (see the Phase 2 notes):
 * changing the ORDER of variables here without re-approving the template sends
 * customers the wrong values in the wrong places.
 */
export function buildTemplateParams(order, status, { shipment = null, user = null, amount = null, stage = null } = {}) {
  const origin = storefrontOrigin();
  if (!origin) return null;
  const name = (order.shippingAddress?.fullName || user?.name || 'there').trim();
  const ref = orderRef(order);
  const src = shipment || order;
  const trackingNumber = String(src.trackingNumber || '').trim();
  const trackLink = src.carrier?.trackingUrl
    || trackOrderUrl(trackingNumber && trackingNumber === order.trackingNumber ? trackingNumber : undefined);
  // A guest has no account page to land on; /track works for everyone.
  const orderLink = user && !user.isGuest ? `${origin}/orders/${order._id}` : trackOrderUrl();
  const refundAmount = Number.isFinite(Number(amount)) && Number(amount) > 0
    ? Number(amount)
    : Number(order.refundDetails?.amount) || Number(order.totalAmount) || 0;

  switch (status) {
    case 'confirmed':
      return [name, formatAmount(order.totalAmount), ref, orderLink];
    case 'shipped':
      return [name, ref, src.carrier?.name || 'our courier partner', trackingNumber || 'to be shared soon', trackLink];
    case 'out_for_delivery':
      return [name, ref];
    case 'delivery_failed':
      return [name, ref, trackLink];
    case 'delivered':
      return [name, ref, `${origin}/contact`];
    case 'cancelled':
      return [name, ref, cancelReason(order)];
    case 'payment_failed':
      // Same target as the email: a signed-in customer retries from the order page.
      return [name, ref, user && !user.isGuest ? `${origin}/orders/${order._id}` : origin];
    case 'refund_initiated':
    case 'refunded':
      return [name, formatAmount(refundAmount), ref];
    case 'preparing':
    case 'packed':
      return [name, ref, orderLink];
    case 'courier_booked':
      return [name, ref, src.carrier?.name || 'our courier partner', trackingNumber || 'to be shared soon', trackLink];
    case 'still_on_it':
      return [name, ref, stillOnItLine(stage), orderLink];
    default:
      return null;
  }
}

/** still_on_it: where the order is, in the same words as the email. */
const stillOnItLine = (stage) => STILL_ON_IT_LINES[stage] || 'our team is working on it';

/** Best-effort audit row; a logging failure must never fail or re-send the message. */
const logMessage = async (fields) => {
  try {
    await notificationLogRepository.upsertByNotificationId(fields.notificationId, fields);
  } catch (err) {
    console.error(`[WhatsApp] Could not write notification log ${fields.notificationId}: ${err.message}`);
  }
};

/**
 * Send the WhatsApp message for one order event, at most once.
 *
 * @param {string} orderId
 * @param {string} status - one of WHATSAPP_EVENTS
 * @param {object} [opts]
 * @param {string} [opts.shipmentId] - one parcel, like the email
 * @param {string|number} [opts.occurrence] - step number / refund id, like the email
 * @param {number} [opts.amount] - refund amount in ₹
 * @param {object} [deps] - injected for tests
 * @returns {Promise<{status: string, messageId?: string}>}
 *   sent | disabled | unsupported | no-template | not-found | skipped | stale | no-consent |
 *   bad-phone | not-allowlisted | no-link | failed
 * @throws on a TRANSIENT send failure, so BullMQ retries (the claim is released first)
 */
export async function sendOrderWhatsApp(orderId, status, opts = {}, deps = {}) {
  const { shipmentId = null, occurrence = null, amount = null } = opts;
  const send = deps.send || sendTemplateMessage;

  const cfg = getWhatsAppConfig(toE164India);
  if (!cfg) return { status: 'disabled' };
  if (!WHATSAPP_EVENTS.has(status)) return { status: 'unsupported' };

  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name isGuest' }]);
  if (!order) return { status: 'not-found' };

  const key = notificationKey(status, shipmentId, occurrence);
  if (order.whatsappNotified?.includes(key)) return { status: 'skipped' };

  const shipment = shipmentId
    ? (order.shipments || []).find((s) => String(s._id) === String(shipmentId))
    : null;
  if (shipmentId && !shipment) return { status: 'not-found' };
  if (!stillRelevant(order, status, shipment, occurrence)) return { status: 'stale' };

  // Consent is per order and must be an explicit yes. Absent (every order placed
  // before this feature) is a no.
  if (order.whatsappOptIn !== true) return { status: 'no-consent' };

  const to = toE164India(order.shippingAddress?.phone);
  if (!to) return { status: 'bad-phone' };
  if (cfg.testRecipients && !cfg.testRecipients.has(to)) return { status: 'not-allowlisted' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  // A progress event whose template has not been approved yet sends nothing rather
  // than a template name Meta would reject (config/whatsapp.js OPTIONAL_TEMPLATES).
  if (!cfg.templates[status]) return { status: 'no-template' };

  const params = buildTemplateParams(order, status, { shipment, user, amount, stage: occurrence });
  if (!params) {
    console.warn(`[WhatsApp] FRONTEND_URL not set — cannot build links; skipping ${status} for order ${orderId}`);
    return { status: 'no-link' };
  }

  // Claim before sending: of two racing jobs only one gets past this line.
  const claimed = await orderRepository.claimWhatsAppNotified(order._id, key);
  if (!claimed) return { status: 'skipped' };

  const template = cfg.templates[status];
  const notificationId = `wa:${order._id}:${key}`;
  const logBase = {
    orderId: order._id,
    ...(user?._id ? { userId: user._id } : {}),
    type: 'whatsapp',
    event: LOG_EVENT[status],
    recipient: to,
    provider: 'meta',
    metadata: { template },
  };

  try {
    const { messageId } = await send({ to, template, language: cfg.language, params }, cfg);
    await logMessage({
      ...logBase, notificationId, status: 'success', providerId: messageId,
      deliveryStatus: 'accepted', deliveryStatusAt: new Date(),
    });
    return { status: 'sent', messageId };
  } catch (err) {
    if (err?.transient !== false) {
      // Could be a blip: give the key back and let BullMQ retry the job.
      await orderRepository.releaseWhatsAppNotified(order._id, key).catch((releaseErr) =>
        console.error(`[WhatsApp] Could not release ${key} on order ${orderId}: ${releaseErr.message}`));
      throw err;
    }
    // Meta said no for good (bad number, template not approved, …). A retry would
    // only be refused again, so keep the claim and record why.
    console.error(`[WhatsApp] ${status} for order ${orderId} permanently rejected: ${err.message}`);
    await logMessage({ ...logBase, notificationId, status: 'failed', errorMessage: String(err.message).slice(0, 500) });
    return { status: 'failed' };
  }
}

// ── Enqueue ──────────────────────────────────────────────────────────────────────

const queueConfigured = () => !!(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL);

/**
 * Queue the WhatsApp message for an order event. Call it right beside the email
 * enqueue for the same event, with the same shipment/occurrence, so both channels key
 * the event identically.
 *
 * Best-effort and never throws: a Redis outage or an unconfigured channel must not
 * fail the staff click or Razorpay webhook that triggered it. Deterministic jobId, so
 * a double-fired hook queues one job; whatsappNotified is the durable guard after it.
 *
 * @param {string|object} orderId
 * @param {string} status
 * @param {{shipmentId?: string, occurrence?: string|number, amount?: number, delayMs?: number}} [opts]
 */
export function enqueueOrderWhatsApp(orderId, status, opts = {}) {
  if (!WHATSAPP_EVENTS.has(status) || !queueConfigured()) return null;
  const cfg = getWhatsAppConfig(toE164India);
  if (!cfg || !cfg.templates[status]) return null;
  const { shipmentId = null, occurrence = null, amount = null } = opts;
  const id = String(orderId);
  // BullMQ refuses ':' in a custom job id.
  const jobId = `wa|${id}|${notificationKey(status, shipmentId, occurrence).replace(/:/g, '|')}`;
  const delay = opts.delayMs ?? (status === 'payment_failed' ? paymentFailedEmailDelayMs() : 0);
  try {
    return queues.getNotificationsQueue()
      .add(
        WHATSAPP_JOB,
        {
          orderId: id, status,
          ...(shipmentId ? { shipmentId: String(shipmentId) } : {}),
          ...(occurrence != null ? { occurrence } : {}),
          ...(amount != null ? { amount } : {}),
        },
        {
          jobId,
          ...(delay > 0 ? { delay } : {}),
          // Meta throttles in bursts: fewer, further-apart retries than an email.
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      )
      .catch((err) => console.error(`[WhatsApp] Failed to enqueue ${status} for order ${id}:`, err.message));
  } catch (err) {
    console.error(`[WhatsApp] Failed to enqueue ${status} for order ${id}:`, err.message);
    return null;
  }
}

export default { sendOrderWhatsApp, enqueueOrderWhatsApp, buildTemplateParams, WHATSAPP_JOB };
