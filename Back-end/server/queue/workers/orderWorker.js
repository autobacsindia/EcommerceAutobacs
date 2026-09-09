/**
 * Order Worker — processes background tasks triggered after order events.
 *
 * ⚠️ LEDGER CALLS ARE BEST-EFFORT AND MUST NOT FAIL THE JOB.
 *
 * These handlers run several independent side effects in sequence. An unguarded throw
 * from the last one fails the whole job, and BullMQ then RETRIES it — re-running the
 * karma and coupon reversals that already succeeded. Those are individually idempotent,
 * so today that is noise rather than corruption, but it makes a transient ledger blip
 * look like a broken order pipeline and it depends on an invariant no one is enforcing.
 * Each call is therefore wrapped and logged for repair.
 *
 * Job names:
 *   post-order-created  { orderId, userId }   — invoice gen, loyalty sync, ERP push
 *   post-order-delivered { orderId }           — loyalty credit, review request
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import * as Sentry from '@sentry/node';
import karmaService from '../../services/karmaService.js';
import couponService from '../../services/couponService.js';
import affiliateCommissionService from '../../services/affiliateCommissionService.js';

/**
 * Run an affiliate-ledger side effect without letting it fail the job.
 *
 * Reported to Sentry rather than swallowed: a clawback that did not happen is real money
 * still owed, so it needs a human, just not a retry storm.
 */
const bestEffort = async (label, orderId, fn) => {
  try {
    return await fn();
  } catch (err) {
    const message = `[Affiliate] ${label} FAILED for order ${orderId} — the ledger needs `
      + 'manual repair. The rest of the post-order job completed.';
    console.error(message, err.message);
    if (process.env.SENTRY_DSN) Sentry.captureMessage(message, 'error');
    return null;
  }
};

const handlers = {
  'post-order-created': async (job) => {
    const { orderId } = job.data;
    // Stub — add invoice generation, ERP integration here
    console.log(`[OrderWorker] post-order-created tasks for order: ${orderId}`);
  },

  // Order delivered → credit earned karma (idempotent). Review-request email TBD.
  'post-order-delivered': async (job) => {
    const { orderId } = job.data;
    const { awarded } = await karmaService.awardForDelivery(orderId);
    /*
      Stamp when the affiliate commission becomes payable: the last line's delivery date
      plus the return window. This is the ONLY place the date is written, which is what
      lets the nightly sweep be an indexed range scan rather than a walk of every pending
      row. It is a hint, not the gate — the sweep re-checks delivery, the window and
      in-flight returns against the live order before approving anything.
    */
    await bestEffort('stampMaturity', orderId, () => affiliateCommissionService.stampMaturity(orderId));
    console.log(`[OrderWorker] post-order-delivered: awarded ${awarded} karma for order ${orderId}`);
  },

  // Order cancelled → restore redeemed karma + release the coupon (idempotent).
  'post-order-cancelled': async (job) => {
    const { orderId } = job.data;
    await karmaService.reverseRedemption(orderId);
    await couponService.releaseForOrder(orderId);
    // The whole order is gone, so the whole commission goes with it.
    await bestEffort('clawback(cancelled)', orderId,
      () => affiliateCommissionService.clawbackForOrder(orderId, 'order_cancelled'));
    console.log(`[OrderWorker] post-order-cancelled: reversed loyalty for order ${orderId}`);
  },

  // Order refunded → restore redeemed karma, release coupon, and claw back earned karma.
  'post-order-refunded': async (job) => {
    const { orderId } = job.data;
    await karmaService.reverseRedemption(orderId);
    await couponService.releaseForOrder(orderId);
    await karmaService.clawbackEarned(orderId);
    await bestEffort('clawback(refunded)', orderId,
      () => affiliateCommissionService.clawbackForOrder(orderId, 'order_refunded'));
    console.log(`[OrderWorker] post-order-refunded: reconciled loyalty for order ${orderId}`);
  },
};

export function startOrderWorker() {
  if (!process.env.REDIS_URL) {
    console.warn('[OrderWorker] REDIS_URL not set — worker disabled');
    return null;
  }

  const worker = new Worker(
    'order-processing',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown order job: ${job.name}`);
      return handler(job);
    },
    {
      connection: createConnection(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[OrderWorker] Job completed: ${job.id} (${job.name})`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[OrderWorker] Job failed: ${job?.id} (${job?.name}) —`, err.message);
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('queue_job', { jobId: job?.id, jobName: job?.name, jobData: job?.data });
        Sentry.captureException(err);
      });
    }
  });

  console.log('[OrderWorker] Started');
  return worker;
}
