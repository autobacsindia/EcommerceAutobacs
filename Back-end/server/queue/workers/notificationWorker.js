/**
 * Notification Worker — processes email and SMS jobs asynchronously.
 *
 * Job names:
 *   send-order-invoice       { orderId }          — generate + email the invoice/receipt (idempotent)
 *   send-order-status-email  { orderId, status }  — fulfillment status-change email (idempotent)
 *   send-review-request      { orderId }          — delayed post-delivery review CTA (idempotent)
 *   send-magic-link-email    { email, token, orderId }
 *   notify-back-in-stock       { productId, variantId } — fan out to everyone waiting on a recovered item
 *   send-back-in-stock-email   { requestId }            — provider send for one claimed request
 *   send-admin-review-alert          { reviewId }       — notify support inbox of a new customer review
 *   send-admin-consultation-alert    { consultationId } — notify support inbox of a new consultation request
 *   send-admin-order-placed-alert    { orderId }        — notify support inbox that an order was paid for
 *   send-admin-order-cancelled-alert { orderId }        — notify support inbox of a customer/admin cancellation
 *   send-admin-refund-failed-alert   { orderId }        — notify support inbox that a refund failed at the gateway
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import emailHandler from '../../services/emailHandler.js';
import { emailOrderInvoice } from '../../services/invoiceService.js';
import { emailOrderStatusUpdate } from '../../services/orderStatusEmailService.js';
import { emailReviewRequest } from '../../services/reviewRequestService.js';
import { fanOutRestock, emailBackInStock } from '../../services/restockNotificationService.js';
import {
  emailAdminReviewAlert,
  emailAdminConsultationAlert,
  emailAdminOrderPlacedAlert,
  emailAdminOrderCancelledAlert,
  emailAdminRefundFailedAlert,
} from '../../services/adminNotificationService.js';
import * as Sentry from '@sentry/node';

const handlers = {
  'send-order-invoice': async (job) => {
    const { orderId } = job.data;
    await emailOrderInvoice(orderId);
  },

  'send-order-status-email': async (job) => {
    const { orderId, status } = job.data;
    await emailOrderStatusUpdate(orderId, status);
  },

  'send-review-request': async (job) => {
    const { orderId } = job.data;
    await emailReviewRequest(orderId);
  },

  'send-magic-link-email': async (job) => {
    const { email, token, orderId } = job.data;
    await emailHandler.sendMagicLinkEmail(email, token, orderId);
  },

  // Fan out: an item recovered — claim every pending request for it and enqueue
  // one send-back-in-stock-email per claimed request (idempotent, concurrency-safe).
  'notify-back-in-stock': async (job) => {
    const { productId, variantId } = job.data;
    await fanOutRestock(productId, variantId ?? null);
  },

  // Provider send for a single already-claimed back-in-stock request.
  'send-back-in-stock-email': async (job) => {
    const { requestId } = job.data;
    await emailBackInStock(requestId);
  },

  'send-admin-review-alert': async (job) => {
    const { reviewId } = job.data;
    await emailAdminReviewAlert(reviewId);
  },

  'send-admin-consultation-alert': async (job) => {
    const { consultationId } = job.data;
    await emailAdminConsultationAlert(consultationId);
  },

  'send-admin-order-placed-alert': async (job) => {
    const { orderId } = job.data;
    await emailAdminOrderPlacedAlert(orderId);
  },

  'send-admin-order-cancelled-alert': async (job) => {
    const { orderId } = job.data;
    await emailAdminOrderCancelledAlert(orderId);
  },

  'send-admin-refund-failed-alert': async (job) => {
    const { orderId } = job.data;
    await emailAdminRefundFailedAlert(orderId);
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
