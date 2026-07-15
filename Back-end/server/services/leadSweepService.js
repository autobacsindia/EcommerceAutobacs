/**
 * leadSweepService — periodic reconciliation for the Sales CRM.
 *
 * Real-time triggers (consultation submit, order failed/paid/cancelled) cover the
 * events we can hook synchronously. These sweeps cover the states that are defined
 * by the PASSAGE OF TIME and so have no event to hang off:
 *
 *   • abandoned checkouts — an order left `pending` past a threshold ("left at
 *     checkout"). We don't lead-ify on creation because most pending orders pay
 *     seconds later; only the ones that go stale are real prospects.
 *   • dormant users — registered accounts that never bought, aged past a window.
 *   • stale follow-ups — worked leads with no activity past the SLA get flagged
 *     for follow-up so they resurface in the rep's queue.
 *
 * Every operation is idempotent (upsert dedups by identity + source ref), so a
 * re-run or overlapping replica is harmless. Repository-only (no model imports)
 * to satisfy the repository-layer lint rule.
 */

import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import leadRepository from '../repositories/leadRepository.js';
import leadSyncService from './leadSyncService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function abandonedCutoff() {
  const minutes = Number(process.env.LEAD_ABANDONED_AFTER_MIN) || 60;
  return new Date(Date.now() - minutes * MIN_MS);
}
// A pending order older than this with no payment is settled as `expired` (customer
// walked away). Kept deliberately >= the payment-reconciliation give-up age (24h) so a
// genuinely-paid-but-webhook-missed order is recovered BEFORE we could ever bury it —
// see services/paymentReconciliationService.js (MAX_AGE_MS). Only the ORDER is closed
// out here; the "left at checkout" lead already formed at abandonedCutoff (60 min).
function expireCutoff() {
  const ms = Number(process.env.LEAD_EXPIRE_AFTER_MS) || 24 * 60 * 60 * 1000; // 24 h
  return new Date(Date.now() - ms);
}
function dormancyCutoff() {
  const days = Number(process.env.LEAD_DORMANCY_DAYS) || 30;
  return new Date(Date.now() - days * DAY_MS);
}
function followUpCutoff() {
  const days = Number(process.env.LEAD_FOLLOWUP_SLA_DAYS) || 3;
  return new Date(Date.now() - days * DAY_MS);
}

const SWEEP_BATCH = Number(process.env.LEAD_SWEEP_BATCH) || 500;

/**
 * Orders stuck in `pending` past the threshold → payment_pending ("left at checkout")
 * leads. Additionally, any that are past the longer expiry window (reconciliation done)
 * are settled to `paymentStatus: 'expired'` so they drop out of the operational Orders
 * view and live on purely as CRM leads. The order doc is NOT deleted — it stays as the
 * lead's source ref and remains auditable.
 */
export async function sweepAbandonedOrders() {
  const orders = await orderRepository.find(
    { status: 'awaiting_payment', paymentStatus: 'pending', createdAt: { $lt: abandonedCutoff() } },
    { limit: SWEEP_BATCH, sort: { createdAt: 1 } }
  );
  const expireBefore = expireCutoff();
  let synced = 0;
  let expired = 0;
  for (const order of orders) {
    // Settle the order as abandoned BEFORE the lead upsert so the lead's snapshot and
    // signal type reflect the final `expired` state. Only touches the payment axis —
    // fulfillment `status` stays `awaiting_payment`.
    if (new Date(order.createdAt) < expireBefore) {
      await orderRepository.update(order._id, {
        $set: { paymentStatus: 'expired' },
        $push: {
          statusHistory: {
            status: order.status,
            timestamp: new Date(),
            reason: 'payment_abandoned',
            notes: 'Auto-expired: no payment within the reconciliation window (customer left checkout).',
          },
        },
      });
      order.paymentStatus = 'expired'; // reflect locally for the lead upsert below
      expired += 1;
    }
    const lead = await leadSyncService.safeSync(() => leadSyncService.upsertFromOrder(order));
    if (lead) synced += 1;
  }
  return { scanned: orders.length, synced, expired };
}

/** Registered (non-guest) users who never bought, aged past the window. */
export async function sweepDormantUsers() {
  const users = await userRepository.find(
    {
      paidOrderCount: 0,
      isGuest: { $ne: true },
      role: { $ne: 'admin' },
      createdAt: { $lt: dormancyCutoff() },
    },
    { limit: SWEEP_BATCH, sort: { createdAt: 1 } }
  );
  let synced = 0;
  for (const user of users) {
    const lead = await leadSyncService.safeSync(() => leadSyncService.upsertFromDormantUser(user));
    if (lead) synced += 1;
  }
  return { scanned: users.length, synced };
}

/**
 * Open leads (new/contacted/qualified) with no follow-up scheduled and no recent
 * activity → set `nextFollowUpAt = now` so they resurface. Idempotent: only
 * touches leads that don't already have a follow-up flag.
 */
export async function sweepStaleLeads() {
  const cutoff = followUpCutoff();
  const stale = await leadRepository.find(
    {
      status: { $in: ['new', 'contacted', 'qualified'] },
      nextFollowUpAt: null,
      $or: [{ lastContactedAt: null }, { lastContactedAt: { $lt: cutoff } }],
      updatedAt: { $lt: cutoff },
    },
    { limit: SWEEP_BATCH, sort: { updatedAt: 1 } }
  );
  let flagged = 0;
  for (const lead of stale) {
    await leadRepository.update(lead._id, { $set: { nextFollowUpAt: new Date() } });
    flagged += 1;
  }
  return { scanned: stale.length, flagged };
}

/** Frequent sweep (abandoned checkouts + stale follow-up flagging). */
export async function runFrequentSweeps() {
  const abandoned = await sweepAbandonedOrders();
  const stale = await sweepStaleLeads();
  return { abandoned, stale };
}

/** Daily sweep (dormant users). */
export async function runDailySweeps() {
  const dormant = await sweepDormantUsers();
  return { dormant };
}
