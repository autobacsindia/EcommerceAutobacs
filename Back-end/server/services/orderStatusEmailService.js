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
 * @param {string} status
 * @param {string|null} [shipmentId]
 * @returns {string}
 */
export const notificationKey = (status, shipmentId = null) =>
  shipmentId ? `${status}:${shipmentId}` : status;

/**
 * Send the status-update email for an order, once per status (or once per parcel).
 * Idempotent via Order.notifiedStatuses so BullMQ retries never double-send.
 * @param {string} orderId
 * @param {string} status - New status (shipped|delivered|cancelled|refunded)
 * @param {object} [opts]
 * @param {string} [opts.shipmentId] - notify about ONE parcel rather than the order
 * @returns {Promise<{status: 'sent'|'skipped'|'no-recipient'|'not-found'}>}
 */
export const emailOrderStatusUpdate = async (orderId, status, opts = {}) => {
  const { shipmentId = null } = opts;
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  // Idempotency: skip if we've already notified the customer for this exact event.
  // For a parcel that means (status, shipmentId) — so parcel 2's "shipped" email is a
  // different key from parcel 1's and actually goes out.
  const key = notificationKey(status, shipmentId);
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
  if (status === 'refunded' && order.payment) {
    try {
      payment = await paymentRepository.findById(order.payment);
    } catch (err) {
      console.warn(`[StatusEmail] Could not load payment for order ${orderId}: ${err.message}`);
    }
  }

  const result = await emailHandler.sendOrderStatusUpdate({
    to, order, status, user, attachments, payment, shipment,
  });

  // Only mark as notified when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the notification.
  if (result?.success) {
    order.notifiedStatuses = [...(order.notifiedStatuses || []), key];
    await orderRepository.save(order);
    return { status: 'sent' };
  }

  throw new Error(
    `Status email failed for order ${orderId} (${key}): ${result?.error || 'unknown error'}`
  );
};

export default { emailOrderStatusUpdate, notificationKey };
