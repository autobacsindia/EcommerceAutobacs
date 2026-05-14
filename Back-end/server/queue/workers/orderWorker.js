/**
 * Order Worker — processes background tasks triggered after order events.
 *
 * Job names:
 *   post-order-created  { orderId, userId }   — invoice gen, loyalty sync, ERP push
 *   post-order-delivered { orderId }           — loyalty credit, review request
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import * as Sentry from '@sentry/node';

const handlers = {
  'post-order-created': async (job) => {
    const { orderId } = job.data;
    // Stub — add invoice generation, loyalty sync, ERP integration here
    console.log(`[OrderWorker] post-order-created tasks for order: ${orderId}`);
  },

  'post-order-delivered': async (job) => {
    const { orderId } = job.data;
    // Stub — loyalty credit, review-request email
    console.log(`[OrderWorker] post-order-delivered tasks for order: ${orderId}`);
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
