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
import emailHandler from './emailHandler.js';

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
 * Send the status-update email for an order, once per status.
 * Idempotent via Order.notifiedStatuses so BullMQ retries never double-send.
 * @param {string} orderId
 * @param {string} status - New status (shipped|delivered|cancelled|refunded)
 * @returns {Promise<{status: 'sent'|'skipped'|'no-recipient'|'not-found'}>}
 */
export const emailOrderStatusUpdate = async (orderId, status) => {
  const order = await orderRepository.findById(orderId, [{ path: 'user', select: 'name email' }]);
  if (!order) return { status: 'not-found' };

  // Idempotency: skip if we've already notified the customer for this status.
  if (order.notifiedStatuses?.includes(status)) return { status: 'skipped' };

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
  if (status === 'shipped' && order.shippingSlip?.url) {
    try {
      const buffer = await downloadToBuffer(order.shippingSlip.url);
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

  const result = await emailHandler.sendOrderStatusUpdate({ to, order, status, user, attachments });

  // Only mark as notified when the provider actually accepted it, so a transient
  // failure lets BullMQ retry rather than silently dropping the notification.
  if (result?.success) {
    order.notifiedStatuses = [...(order.notifiedStatuses || []), status];
    await orderRepository.save(order);
    return { status: 'sent' };
  }

  throw new Error(
    `Status email failed for order ${orderId} (${status}): ${result?.error || 'unknown error'}`
  );
};

export default { emailOrderStatusUpdate };
