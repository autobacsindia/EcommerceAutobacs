/**
 * Automatic team-chat posts for business events.
 *
 * These ride the notification queue that ALREADY fires for each of these events
 * and already emails the same people. Nothing new is hooked into checkout,
 * payment or order code: a job that has just finished its email also posts a
 * line in the right space. So the money path is untouched, and if chat is down
 * the business event is unaffected.
 *
 * Every post carries an idempotency key, because BullMQ retries jobs: the same
 * event posts once, however many times its job runs.
 */
import { postSystemMessage } from './chatService.js';
import orderRepository from '../repositories/orderRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import { orderNumber } from './invoiceService.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const customerOf = (order) => order?.shippingAddress?.fullName || 'Customer';

/** The item line an alert is about, by its id within the order. */
const itemName = (order, itemId) => {
  const item = (order?.items || []).find((i) => String(i._id) === String(itemId));
  return item?.name || item?.product?.name || 'an item';
};

/**
 * jobName → how it becomes a chat post. Each returns null when there is nothing
 * worth saying (record gone, etc.), and never throws.
 */
const UPDATES = {
  // A customer has paid. Operations runs the fulfilment queue from here.
  'send-staff-sales-paid-alert': async ({ orderId }) => {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    return {
      space: 'team:operations',
      key: `order-paid-${orderId}`,
      orderIds: [orderId],
      text: `🟢 Paid order ${orderNumber(order)} — ${inr(order.totalAmount)} — ${customerOf(order)}. Procurement: please check stock.`,
    };
  },

  // Procurement could not source a line: the sales side must ask the customer.
  'send-team-out-of-stock-alert': async ({ orderId, itemId }) => {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    return {
      space: 'team:procurement',
      key: `out-of-stock-${orderId}-${itemId}`,
      orderIds: [orderId],
      text: `🟠 Out of stock on ${orderNumber(order)} — ${itemName(order, itemId)}. Sales: ask the customer to wait or refund.`,
    };
  },

  // A refund needs an Accounts decision.
  'send-team-refund-requested-alert': async ({ orderId, itemId }) => {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    return {
      space: 'team:accounts',
      key: `refund-requested-${orderId}-${itemId}`,
      orderIds: [orderId],
      text: `🔴 Refund requested on ${orderNumber(order)} — ${itemName(order, itemId)} — ${customerOf(order)}. Accounts: please review.`,
    };
  },

  // A new enquiry from the website.
  'send-admin-consultation-alert': async ({ consultationId }) => {
    const lead = await consultationRepository.findById(consultationId);
    if (!lead) return null;
    const car = lead.vehicleNumber ? ` · ${lead.vehicleNumber}` : '';
    return {
      space: 'team:sales',
      key: `lead-${consultationId}`,
      text: `💬 New consultation request from ${lead.name}${car}. Sales: please follow up.`,
    };
  },
};

/** Job names that produce a chat post — cheap check before doing any work. */
export const hasChatUpdate = (jobName) => Object.hasOwn(UPDATES, jobName);

/**
 * Post the chat line for a finished notification job.
 * Always resolves; failures are logged and swallowed so the job still succeeds.
 */
export async function postBusinessUpdate(jobName, data = {}) {
  const build = UPDATES[jobName];
  if (!build) return null;
  try {
    const update = await build(data);
    if (!update) return null;
    return await postSystemMessage(update.space, update.text, { key: update.key, orderIds: update.orderIds });
  } catch (err) {
    console.error(`[chat] business update for ${jobName} failed (ignored):`, err.message);
    return null;
  }
}
