/**
 * Notification Worker — processes email and SMS jobs asynchronously.
 *
 * Job names:
 *   send-confirmation-email  { orderId, email, orderNumber, totalAmount }
 *   send-magic-link-email    { email, token, orderId }
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import emailHandler from '../../services/emailHandler.js';
import * as Sentry from '@sentry/node';

const handlers = {
  'send-confirmation-email': async (job) => {
    const { email, orderId, orderNumber, totalAmount } = job.data;
    await emailHandler.sendOrderConfirmation(email, { orderId, orderNumber, totalAmount });
  },

  'send-magic-link-email': async (job) => {
    const { email, token, orderId } = job.data;
    await emailHandler.sendMagicLinkEmail(email, token, orderId);
  },
};

export function startNotificationWorker() {
  if (!process.env.REDIS_URL) {
    console.warn('[NotificationWorker] REDIS_URL not set — worker disabled');
    return null;
  }

  const worker = new Worker(
    'notifications',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown notification job: ${job.name}`);
      return handler(job);
    },
    {
      connection: createConnection(),
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[NotificationWorker] Job completed: ${job.id} (${job.name})`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[NotificationWorker] Job failed: ${job?.id} (${job?.name}) —`, err.message);
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('queue_job', { jobId: job?.id, jobName: job?.name, jobData: job?.data });
        Sentry.captureException(err);
      });
    }
  });

  console.log('[NotificationWorker] Started');
  return worker;
}
