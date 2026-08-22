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
import couponRedemptionRepository from '../repositories/couponRedemptionRepository.js';
import leadSyncService from './leadSyncService.js';
import couponService from './couponService.js';
import karmaService from './karmaService.js';
import { computeLeadScore } from '../utils/leadScore.js';
import { OPEN_LEAD_STATUSES } from '../config/leadConstants.js';

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
/*
  How long an unpaid checkout keeps its MONEY HOLDS — the coupon's per-user counter, the
  campaign redemption slot, and any karma points debited.

  Deliberately MUCH shorter than expireCutoff's 24 h, because the two decisions carry
  opposite risks. Burying an order early hides a real order from the operational view, so
  that one waits for the full reconciliation window. Releasing a hold early only ever
  hands the customer back a reward they can use again — the forgiving direction — while
  holding one too long tells someone who never paid that they have "already used" the
  offer, and drains a campaign's cap on orders that were never orders.

  Two hours is safe because paymentReconciliationService has by then asked Razorpay
  DIRECTLY, roughly a dozen times, whether this order was captured, and been told no. It
  is not an assumption about customer behaviour; it is the gateway's own answer.
*/
function holdReleaseCutoff() {
  const ms = Number(process.env.CHECKOUT_HOLD_RELEASE_MS) || 2 * 60 * 60 * 1000; // 2 h
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

/**
 * Hand back the money holds on checkouts that were abandoned before payment.
 *
 * orderService takes three things at order CREATION, before a rupee moves: the coupon's
 * global and per-user counters, the campaign's redemption slot, and any karma points
 * spent. That timing is not incidental — a guarded counter is the only thing that stops
 * two racing tabs both claiming the last slot, and it has to exist before the payment is
 * attempted to do that job.
 *
 * They come back when an order is cancelled or refunded (queue/workers/orderWorker.js).
 * Nothing gave them back when the customer simply never paid — closed the tab, let the
 * UPI request lapse, dismissed the Razorpay popup — which is roughly a quarter of all
 * orders created. Those customers were then told "you have already used this offer" for
 * ever, having paid nothing, and a capped campaign spent slots on orders that never
 * existed.
 *
 * Driven from the redemption audit rows, not from Orders: a redemption exists only where
 * a coupon was actually used, so this asks a small question rather than scanning every
 * abandoned checkout. Idempotent by construction — releaseForOrder deletes that audit row
 * last, inside the same transaction as the counters, so a second pass simply finds
 * nothing to do.
 *
 * Deliberately does NOT touch `status` or `paymentStatus`. Releasing a hold says nothing
 * about where the parcel is or what the gateway thinks, and CRM lead classification reads
 * paymentStatus — moving it here would silently reclassify leads as a side effect of a
 * money fix.
 */
export async function sweepStaleCheckoutHolds() {
  const stale = await couponRedemptionRepository.findStaleBefore(holdReleaseCutoff(), SWEEP_BATCH);
  let released = 0;
  let skipped = 0;

  for (const redemption of stale) {
    const order = await orderRepository.findById(redemption.order);

    /*
      An orphaned redemption — its order was hard-deleted (the offline payment-link
      rollback path does exactly that). Release it: the counters it holds can never be
      settled by anything else, and leaving them is the same leak by another route.
    */
    if (!order) {
      await releaseHolds(redemption.order);
      released += 1;
      continue;
    }

    // Still live: paid, already past checkout, or resolved as cancelled/refunded (whose
    // own release path has run or will run). Only a genuinely stranded checkout qualifies.
    if (order.status !== 'awaiting_payment' || order.paymentStatus === 'paid') {
      skipped += 1;
      continue;
    }

    /*
      Stamp BEFORE releasing, not after.

      The stamp is what stops the order being paid once its holds are gone; if the release
      succeeded and the stamp then failed, the order would be payable at a discount that
      counts against nothing. Stamping first can at worst leave an order unpayable with its
      holds intact — recoverable, caught on the next pass, and the direction to fail in.
    */
    await orderRepository.update(order._id, {
      $set: { holdsReleasedAt: new Date() },
      $push: {
        statusHistory: {
          status: order.status,
          timestamp: new Date(),
          reason: 'payment_abandoned',
          notes: 'Coupon, campaign and karma holds released — no payment within the window.',
        },
      },
    });

    await releaseHolds(order._id);
    released += 1;
  }

  return { scanned: stale.length, released, skipped };
}

/**
 * Give back everything an unpaid order was holding. Each half is guarded on its own: a
 * karma failure must not leave the coupon held, nor the reverse, and neither must stop
 * the sweep reaching the next order.
 */
async function releaseHolds(orderId) {
  try {
    await couponService.releaseForOrder(orderId);
  } catch (err) {
    console.error(`[LeadSweep] coupon release failed for order ${orderId}:`, err.message);
  }
  try {
    await karmaService.reverseRedemption(orderId);
  } catch (err) {
    console.error(`[LeadSweep] karma reversal failed for order ${orderId}:`, err.message);
  }
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
      status: { $in: OPEN_LEAD_STATUSES },
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

/**
 * Refresh `leadScore` on ALL open leads so the recency term decays over time.
 * Real-time recompute (leadSyncService) already covers every new signal; this only
 * corrects passage-of-time drift, so a once-daily full pass is enough.
 *
 * Full pass (not an oldest-N slice): a per-run cap that always restarts from the
 * smallest _id would forever rescore the same oldest leads and never reach newer
 * ones, so their decay would never run. Instead we page the whole open set via a
 * keyset cursor on the immutable _id (writing leadScore bumps updatedAt, so a
 * skip/updatedAt cursor would drift), with a large batch-count guard against a
 * runaway loop. Changed docs are flushed per batch with a single bulkWrite.
 */
export async function sweepRescoreLeads() {
  const maxBatches = Number(process.env.LEAD_RESCORE_MAX_BATCHES) || 1000; // runaway guard
  let scanned = 0;
  let updated = 0;
  let afterId = null;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const filter = { status: { $in: OPEN_LEAD_STATUSES } };
    if (afterId) filter._id = { $gt: afterId };
    const leads = await leadRepository.find(filter, { limit: SWEEP_BATCH, sort: { _id: 1 } });
    if (leads.length === 0) break;

    const ops = [];
    for (const lead of leads) {
      const next = computeLeadScore(lead);
      if (next !== lead.leadScore) {
        ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: { leadScore: next } } } });
      }
    }
    if (ops.length) {
      await leadRepository.bulkWrite(ops);
      updated += ops.length;
    }
    scanned += leads.length;
    afterId = leads[leads.length - 1]._id;
    if (leads.length < SWEEP_BATCH) break;
  }
  return { scanned, updated };
}

/** Frequent sweep (abandoned checkouts + stale follow-up flagging). */
export async function runFrequentSweeps() {
  const abandoned = await sweepAbandonedOrders();
  const holds = await sweepStaleCheckoutHolds();
  const stale = await sweepStaleLeads();
  return { abandoned, holds, stale };
}

/** Daily sweep (dormant users + score recency-decay refresh). */
export async function runDailySweeps() {
  const dormant = await sweepDormantUsers();
  const rescored = await sweepRescoreLeads();
  return { dormant, rescored };
}
