/**
 * What follows once an extra charge is PAID or its order closes.
 *
 * Kept apart from orderExtraChargeService on purpose: razorpayService and
 * orderStatusService call these, and neither may depend on a service that itself
 * depends on them. Nothing here can undo or fail a payment — it runs after commit.
 */
import * as Sentry from '@sentry/node';
import orderExtraChargeRepository from '../repositories/orderExtraChargeRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import { CLOSED_ORDER_STATUSES } from '../config/extraCharges.js';
import { idOf, liveLink } from '../utils/extraCharge.js';

const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const SWEEP_BATCH = 500;

// Loaded on use: orderStatusService and razorpayService import this file, and the
// chat and queue modules (Redis) should not become load-time dependencies of those.
const chat = () => import('./chatService.js');
const queues = () => import('../queue/queues.js');

export async function tellExtraChat(extra, action, text, { mentionSeller = false } = {}) {
  try {
    const admins = (await userRepository.findChatUsers()).filter((u) => u.role === 'admin').map((u) => idOf(u));
    const mentions = [...admins, ...(mentionSeller && extra.salesUser ? [idOf(extra.salesUser)] : [])];
    const { postSystemMessage } = await chat();
    await Promise.all(['team:accounts', 'team:sales'].map((space) => postSystemMessage(space, text, {
      key: `extracharge-${idOf(extra._id)}-${action}`,
      mentions,
      threadOrder: idOf(extra.order),
      orderIds: [idOf(extra.order)],
    })));
  } catch (err) {
    console.error('[ExtraCharge] chat update failed (ignored):', err.message);
  }
}

/** Called exactly once per extra, by whichever path turned it paid. */
export async function afterExtraPaid(extraId) {
  try {
    const extra = await orderExtraChargeRepository.findById(extraId);
    if (!extra) return;
    (await queues()).enqueueNotification('send-extra-charge-receipt', { extraId: idOf(extra._id) });
    await tellExtraChat(extra, 'paid',
      `💰 ${extra.orderNumber} — extra charge of ${inr(extra.amount)} received: ${extra.reason}.`
      + (extra.refund?.status === 'due' ? ' The order is closed or the extra was cancelled, so this money must go back: Admin → Refunds.' : ''),
      { mentionSeller: true });
  } catch (err) {
    console.error('[ExtraCharge] after-paid step failed (ignored):', err.message);
    Sentry.captureException(err, { extra: { extraId: String(extraId) } });
  }
}

/**
 * The order is cancelled or fully returned: a paid extra goes on Admin's refund
 * list, and an unpaid one is closed so the customer can no longer pay it.
 * A transfer waiting for Accounts is left alone (the money may be in the bank); it is
 * settled when Accounts decides. Idempotent; the sweep re-runs it after any failure.
 */
export async function closeExtrasForOrder(orderId, why = 'Order closed') {
  const extras = await orderExtraChargeRepository.findByOrder(orderId);
  let changed = 0;
  for (const extra of extras) {
    const now = new Date();
    if (extra.status === 'paid' && !extra.refund) {
      const done = await orderExtraChargeRepository.transition(
        { _id: extra._id, status: 'paid', refund: { $exists: false } },
        { $set: { refund: { status: 'due', dueReason: why } }, $push: { history: { at: now, action: 'refund_due', note: why } } },
      );
      if (done) {
        changed += 1;
        await tellExtraChat(done, 'refund-due', `↩️ ${done.orderNumber} — ${why}. The paid extra of ${inr(done.amount)} must be refunded: Admin → Refunds.`);
      }
    } else if (['awaiting_accounts', 'approved'].includes(extra.status) && !extra.bankTransferPendingAt) {
      const link = liveLink(extra);
      if (link) {
        const { default: razorpayService } = await import('./razorpayService.js');
        try {
          await razorpayService.cancelPaymentLink(link.id);
        } catch (err) {
          // Most likely just paid: the webhook records it and flags the refund.
          console.error(`[ExtraCharge] could not cancel link ${link.id}: ${err.message}`);
          continue;
        }
      }
      const done = await orderExtraChargeRepository.transition(
        { _id: extra._id, status: extra.status, bankTransferPendingAt: { $exists: false } },
        {
          $set: { status: 'cancelled', 'links.$[l].status': 'cancelled' },
          $push: { history: { at: now, action: 'cancelled', note: why } },
        },
        { arrayFilters: [{ 'l.status': 'pending' }] },
      );
      if (done) changed += 1;
    }
  }
  return changed;
}

/** Hook used right after an order is cancelled or returned. Never throws: the sweep is the backstop. */
export async function closeExtrasBestEffort(orderId, why) {
  try {
    await closeExtrasForOrder(orderId, why);
  } catch (err) {
    console.error(`[ExtraCharge] closing extras for order ${orderId} failed — the sweep will retry:`, err.message);
    Sentry.captureException(err, { extra: { orderId: String(orderId) } });
  }
}

/**
 * Backstop for a hook that failed: the newest extras still open or paid, whose
 * order has since closed. Two bounded reads.
 */
export async function sweepExtrasOnClosedOrders() {
  const rows = await orderExtraChargeRepository.model.find({
    status: { $in: ['awaiting_accounts', 'approved', 'paid'] },
    refund: { $exists: false },
  }).sort({ _id: -1 }).limit(SWEEP_BATCH).select('order').lean();
  if (!rows.length) return 0;
  const ids = [...new Set(rows.map((r) => String(r.order)))];
  const closed = await orderRepository.model.find({ _id: { $in: ids }, status: { $in: CLOSED_ORDER_STATUSES } }).select('_id status').lean();
  let changed = 0;
  for (const order of closed) {
    changed += await closeExtrasForOrder(order._id, `Order ${order.status}`);
  }
  return changed;
}
