/**
 * Order status-change email service.
 *
 * Sends the customer a notification when their order reaches a fulfillment
 * milestone (shipped / delivered / cancelled / refunded). Enqueued from
 * orderStatusService._enqueueStatusNotification and processed by the
 * notification worker (send-order-status-email job).
 *
 * Mirrors invoiceService.emailOrderInvoice: DB access + idempotency live here,
 * the actual send is provider-only in emailHandler.sendOrderStatusUpdate.
 */

import orderRepository from '../repositories/orderRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import emailHandler from './emailHandler.js';
import { readPrivateAsset } from './storage/privateUploads.js';
import { hashOf } from './deliveryUpdateEmailService.js';
import { getNotificationsQueue } from '../queue/queues.js';
import { PARCEL_STEP } from '../utils/parcelSteps.js';

/**
 * Download a URL into a Buffer (used to fetch the Cloudinary-hosted shipping slip
 * for email attachment). Uses global fetch (Node ≥ 18). Throws on non-2xx.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
const downloadToBuffer = async (url) => {
  // Bounded: a stalled Cloudinary connection must not hang the notification worker
  // (Node fetch has no default timeout). AbortSignal.timeout → fetch rejects at 10s.
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

/**
 * The idempotency key stored in `Order.notifiedStatuses`.
 *
 * ⚠️ THIS IS THE FIX FOR A REAL SWALLOWED EMAIL. The guard used to be the bare status
 * word, and the send is skipped when the array already contains it — so the moment an
 * order shipped in two parcels, the SECOND "your order has shipped" email was silently
 * dropped and the customer was never told about their other box. Keying on the parcel
 * makes each one notifiable exactly once.
 *
 * Order-level events (cancelled, refunded, and every historical order) keep the bare
 * word, so nothing already sent is ever re-sent after this change ships.
 *
 * `occurrence` is for events that can legitimately happen more than once on the same
 * parcel or order: a courier step (a parcel can be out for delivery, missed, and out
 * for delivery again — keyed on the parcel's step number) or a refund (keyed on the
 * Razorpay refund id). Without it the second "out for delivery" would be swallowed
 * exactly like the second parcel's "shipped" email was.
 *
 * @param {string} status
 * @param {string|null} [shipmentId]
 * @param {string|number|null} [occurrence]
 * @returns {string}
 */
export const notificationKey = (status, shipmentId = null, occurrence = null) =>
  [status, shipmentId, occurrence].filter((part) => part != null && part !== '').join(':');

/**
 * Is this email still true by the time the worker runs it? Each answer is read off the
 * order the worker just loaded, so a delayed or retried job never tells the customer
 * something that has stopped being the case.
 *   payment_failed  — sent after a delay (see razorpayService.handlePaymentFailure);
 *                     a customer who retried and paid in the meantime gets nothing.
 *   out_for_delivery / delivery_failed — only while the parcel is still in transit;
 *                     once it is delivered (or lost) the step is old news.
 * Every other status was true when it was enqueued and stays true.
 * @returns {boolean}
 */
export const stillRelevant = (order, status, shipment) => {
  if (status === 'payment_failed') {
    return order.status === 'awaiting_payment' && order.paymentStatus !== 'paid';
  }
  if (status === 'out_for_delivery' || status === 'delivery_failed') {
    return shipment?.status === 'shipped';
  }
  return true;
};

/**
 * Send the status-update email for an order, once per status (or once per parcel).
 * Idempotent via Order.notifiedStatuses so BullMQ retries never double-send.
 * @param {string} orderId
 * @param {string} status - shipped|delivered|cancelled|refunded|returned, or
 *   out_for_delivery|delivery_failed (one parcel), payment_failed, refund_initiated
 * @param {object} [opts]
 * @param {string} [opts.shipmentId] - notify about ONE parcel rather than the order
 * @param {string|number} [opts.occurrence] - which time this event happened (parcel
 *   step number, Razorpay refund id) — see notificationKey
 * @param {{amount: number}} [opts.refund] - refund_initiated: the amount in ₹
 * @param {string} [opts.note] - delivery_failed: the step's note
 * @returns {Promise<{status: 'sent'|'skipped'|'stale'|'no-recipient'|'not-found'}>}
 */
export const emailOrderStatusUpdate = async (orderId, status, opts = {}) => {
  const { shipmentId = null, occurrence = null, refund = null, note = '' } = opts;
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  // Idempotency: skip if we've already notified the customer for this exact event.
  // For a parcel that means (status, shipmentId) — so parcel 2's "shipped" email is a
  // different key from parcel 1's and actually goes out.
  const key = notificationKey(status, shipmentId, occurrence);
  if (order.notifiedStatuses?.includes(key)) return { status: 'skipped' };

  // The parcel this email is about, and what is still to come after it. Both are
  // undefined for an order-level email, which renders exactly as it always did.
  const shipment = shipmentId
    ? (order.shipments || []).find((s) => String(s._id) === String(shipmentId))
    : null;
  if (shipmentId && !shipment) {
    console.warn(`[StatusEmail] Parcel ${shipmentId} not found on order ${orderId} — skipping`);
    return { status: 'not-found' };
  }

  if (!stillRelevant(order, status, shipment)) return { status: 'stale' };

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const to = user?.email || order.guestEmail;
  if (!to) {
    console.warn(`[StatusEmail] No recipient email for order ${orderId} — skipping ${status} email`);
    return { status: 'no-recipient' };
  }

  // For a shipped order with an uploaded courier slip, attach the PDF. Best-effort:
  // if the download fails we still send the (tracking-only) email rather than block
  // the notification — a missing attachment shouldn't strand the customer.
  let attachments;
  // A parcel's own slip wins over the order-level one: with several boxes in flight,
  // attaching the order's single legacy slip to every email would send the wrong
  // paperwork for every parcel but the first.
  const slip = shipment ? shipment.shippingSlip : order.shippingSlip;
  /*
    An R2 slip lives in the private bucket and therefore has NO url — the ref's
    publicId is the only handle. Testing `url` here (as this did) silently drops
    the attachment for every R2 slip and sends a tracking-only email that still
    says "your shipping slip is attached". Test the ref instead and let
    readPrivateAsset decide how to fetch it.
  */
  if (status === 'shipped' && (slip?.publicId || slip?.url)) {
    try {
      const buffer = await readPrivateAsset(slip, downloadToBuffer);
      const ref = `AB-${order._id.toString().slice(-8).toUpperCase()}`;
      attachments = [{
        Name: `shipping-slip-${ref}.pdf`,
        Content: buffer.toString('base64'),
        ContentType: 'application/pdf',
      }];
    } catch (err) {
      console.error(`[StatusEmail] Failed to attach slip for order ${orderId}: ${err.message}`);
    }
  }

  // Refund emails carry the EMI caveat (principal-only refund; bank keeps the interest),
  // which needs the Payment row. Fetched only for that status, and best-effort — a
  // failed lookup drops the caveat rather than blocking the refund notification.
  let payment = null;
  if ((status === 'refunded' || status === 'refund_initiated') && order.payment) {
    try {
      payment = await paymentRepository.findById(order.payment);
    } catch (err) {
      console.warn(`[StatusEmail] Could not load payment for order ${orderId}: ${err.message}`);
    }
  }

  const result = await emailHandler.sendOrderStatusUpdate({
    to, order, status, user, attachments, payment, shipment, refund, note,
  });

  // Only mark as notified when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the notification.
  if (result?.success) {
    // Atomic $addToSet, never a whole-array save: see orderRepository.addNotifiedStatus.
    await orderRepository.addNotifiedStatus(order._id, key);
    // Remember which tracking details the customer now has, so a later correction
    // emails them once and a re-save of the same values emails nothing
    // (services/deliveryUpdateEmailService.js). Only for a parcel email, or a legacy
    // order with no parcels — those are the details the customer actually saw.
    if (status === 'shipped' && (shipment || !(order.shipments || []).length)) {
      const src = shipment || order;
      src.deliveryNotice = { hash: hashOf(src), sentAt: new Date() };
      await orderRepository.save(order);
    }
    return { status: 'sent' };
  }

  throw new Error(
    `Status email failed for order ${orderId} (${key}): ${result?.error || 'unknown error'}`
  );
};

// ── Enqueue helpers ──────────────────────────────────────────────────────────────
// Best-effort, like every other notification enqueue: a Redis/queue outage must never
// fail the staff click or the Razorpay webhook that triggered the email. Each job has
// a deterministic jobId, so BullMQ itself drops a duplicate add (a replayed webhook,
// a double-fired hook) while the first job is still kept; the notifiedStatuses stamp
// is the second, durable guard after that.

const queueConfigured = () => !!(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL);

const addJob = (name, data, opts, label) => {
  if (!queueConfigured()) return null;
  try {
    return getNotificationsQueue()
      .add(name, data, opts)
      .catch((err) => console.error(`[StatusEmail] Failed to enqueue ${label}:`, err.message));
  } catch (err) {
    console.error(`[StatusEmail] Failed to enqueue ${label}:`, err.message);
    return null;
  }
};

/** The courier steps that email the customer. Picked up / in transit stay on the order page. */
export const CUSTOMER_EMAILED_STEPS = new Set([PARCEL_STEP.OUT_FOR_DELIVERY, PARCEL_STEP.DELIVERY_FAILED]);

/**
 * A courier step was recorded on a parcel (team panel). `stepNumber` is the parcel's
 * stepCount after the step — unique per parcel, so a second "out for delivery" after
 * a missed delivery is its own email, while a retry of the same one is not.
 */
export function enqueueParcelStepEmail(orderId, shipmentId, step, stepNumber, note = '') {
  if (!CUSTOMER_EMAILED_STEPS.has(step)) return null;
  return addJob(
    'send-shipment-email',
    { orderId: String(orderId), shipmentId: String(shipmentId), kind: step, occurrence: stepNumber, note },
    { jobId: `parcel-step|${shipmentId}|${stepNumber}` },
    `${step} email for parcel ${shipmentId}`,
  );
}

/**
 * How long after a failed payment we wait before emailing. Most failures are retried
 * in the same Razorpay window within a minute or two (wrong OTP, a declined card then
 * UPI); emailing at once would tell a customer who has just paid that they have not.
 * The worker re-checks the order (stillRelevant) before sending.
 */
export const paymentFailedEmailDelayMs = () => {
  const minutes = Number(process.env.PAYMENT_FAILED_EMAIL_DELAY_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 30) * 60 * 1000;
};

/** One "your payment didn't go through" email per order, however many attempts fail. */
export function enqueuePaymentFailedEmail(orderId) {
  return addJob(
    'send-order-status-email',
    { orderId: String(orderId), status: 'payment_failed' },
    { jobId: `payment-failed|${orderId}`, delay: paymentFailedEmailDelayMs() },
    `payment-failed email for order ${orderId}`,
  );
}

/** One "we've started your refund" email per Razorpay refund. `amount` is in ₹. */
export function enqueueRefundStartedEmail(orderId, refundId, amount) {
  return addJob(
    'send-order-status-email',
    { orderId: String(orderId), status: 'refund_initiated', refundId: String(refundId), amount },
    { jobId: `refund-started|${refundId}` },
    `refund-started email for order ${orderId}`,
  );
}

export default {
  emailOrderStatusUpdate, notificationKey, stillRelevant,
  enqueueParcelStepEmail, enqueuePaymentFailedEmail, enqueueRefundStartedEmail,
};
