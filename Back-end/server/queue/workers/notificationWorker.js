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
 *   send-admin-careers-alert         { applicationId }  — notify support inbox of a new careers application
 *   send-careers-acknowledgement     { applicationId }  — confirm receipt to the applicant (idempotent)
 *   send-careers-rejection           { applicationId }  — notify the applicant they weren't selected (idempotent)
 *   send-admin-order-placed-alert    { orderId }        — notify support inbox that an order was paid for
 *   send-admin-order-cancelled-alert { orderId }        — notify support inbox of a customer/admin cancellation
 *   send-admin-refund-failed-alert   { orderId }        — notify support inbox that a refund failed at the gateway
 *   send-return-submitted            { returnId }        — acknowledge a new return request to the customer (idempotent)
 *   send-return-status-email         { returnId, event } — return lifecycle email to the customer (approved/courier_booked/received/rejected/refunded)
 *   send-admin-return-alert          { returnId }        — notify support inbox of a new return request
 *   send-admin-return-refunded-alert { returnId }        — log to support inbox that a return refund was initiated
 *   process-inbound-email            { inboundId }       — parse a captured support email into a ticket (idempotent)
 *   send-support-acknowledgement     { ticketId }        — confirm a new ticket to the customer (loop-guarded)
 *   send-support-reply               { ticketId, body, authorId, authorName } — an agent's reply to the customer
 *   send-support-resolution          { ticketId }        — tell the customer their ticket is resolved
 *   create-support-ticket            { sourceModel, sourceId } — open a linked ticket for a
 *                                                          ProductQuestion / Review / ReturnRequest (idempotent)
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import emailHandler from '../../services/emailHandler.js';
import { emailOrderInvoice } from '../../services/invoiceService.js';
import { emailOrderStatusUpdate } from '../../services/orderStatusEmailService.js';
import { emailReviewRequest } from '../../services/reviewRequestService.js';
import { fanOutRestock, emailBackInStock } from '../../services/restockNotificationService.js';
import { emailCareersAcknowledgement, emailCareersRejection } from '../../services/careersApplicantEmailService.js';
import {
  emailAdminReviewAlert,
  emailAdminConsultationAlert,
  emailAdminCareersAlert,
  emailAdminOrderPlacedAlert,
  emailAdminOrderCancelledAlert,
  emailAdminRefundFailedAlert,
  emailAdminReturnAlert,
  emailAdminReturnRefundedAlert,
} from '../../services/adminNotificationService.js';
import { emailReturnSubmitted, emailReturnStatus } from '../../services/returnCustomerEmailService.js';
import inboundEmailService from '../../services/inboundEmailService.js';
import supportEmailService from '../../services/supportEmailService.js';
import supportTicketRepository from '../../repositories/supportTicketRepository.js';
import productQuestionRepository from '../../repositories/productQuestionRepository.js';
import reviewRepository from '../../repositories/reviewRepository.js';
import returnRequestRepository from '../../repositories/returnRequestRepository.js';
import {
  ticketFromProductQuestion,
  ticketFromReview,
  ticketFromReturn,
} from '../../services/supportChannelAdapters.js';
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

  // Spin-to-Win: for a coupon prize this email carries the ONLY durable copy of the
  // code — the reveal screen is transient. Idempotent via SpinResult.prizeEmailedAt.
  'send-spin-prize-email': async (job) => {
    const { orderId } = job.data;
    const { emailSpinPrize } = await import('../../services/spinPrizeEmailService.js');
    await emailSpinPrize(orderId);
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

  'send-admin-careers-alert': async (job) => {
    const { applicationId } = job.data;
    await emailAdminCareersAlert(applicationId);
  },

  'send-careers-acknowledgement': async (job) => {
    const { applicationId } = job.data;
    await emailCareersAcknowledgement(applicationId);
  },

  'send-careers-rejection': async (job) => {
    const { applicationId } = job.data;
    await emailCareersRejection(applicationId);
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

  'send-return-submitted': async (job) => {
    const { returnId } = job.data;
    await emailReturnSubmitted(returnId);
  },

  'send-return-status-email': async (job) => {
    const { returnId, event } = job.data;
    await emailReturnStatus(returnId, event);
  },

  'send-admin-return-alert': async (job) => {
    const { returnId } = job.data;
    await emailAdminReturnAlert(returnId);
  },

  'send-admin-return-refunded-alert': async (job) => {
    const { returnId } = job.data;
    await emailAdminReturnRefundedAlert(returnId);
  },

  /**
   * Parse a captured inbound email into a ticket.
   *
   * The acknowledgement is chained here rather than sent inside the service so
   * that a Postmark outage retries only the send, never the parse — reprocessing
   * is idempotent but pointless work.
   */
  'process-inbound-email': async (job) => {
    const { inboundId } = job.data;
    const result = await inboundEmailService.processInbound(inboundId);

    if (result.shouldAcknowledge && result.ticket) {
      const ticket = await supportTicketRepository.findByReference(result.ticket);
      if (ticket) await supportEmailService.sendAcknowledgement(ticket);
    }
    return result;
  },

  'send-support-acknowledgement': async (job) => {
    const { ticketId } = job.data;
    const ticket = await supportTicketRepository.findById(ticketId);
    if (!ticket) return { skipped: 'ticket not found' };
    return supportEmailService.sendAcknowledgement(ticket);
  },

  'send-support-reply': async (job) => {
    const { ticketId, body, authorId, authorName } = job.data;
    const ticket = await supportTicketRepository.findById(ticketId);
    if (!ticket) return { skipped: 'ticket not found' };
    return supportEmailService.sendAgentReply(ticket, body, {
      user: authorId,
      name: authorName,
    });
  },

  'send-support-resolution': async (job) => {
    const { ticketId } = job.data;
    const ticket = await supportTicketRepository.findById(ticketId);
    if (!ticket) return { skipped: 'ticket not found' };
    return supportEmailService.sendResolutionNotice(ticket);
  },

  /**
   * Open a linked support ticket for a record from another channel.
   *
   * Done asynchronously so ticket creation can never fail the customer's
   * original request — a question, review or return must still be accepted even
   * if the support side is briefly unavailable. Idempotent on
   * (sourceModel, sourceId), so a retry never doubles up.
   */
  'create-support-ticket': async (job) => {
    const { sourceModel, sourceId } = job.data;

    const loaders = {
      ProductQuestion: [productQuestionRepository, ticketFromProductQuestion],
      Review: [reviewRepository, ticketFromReview],
      ReturnRequest: [returnRequestRepository, ticketFromReturn],
    };

    const entry = loaders[sourceModel];
    if (!entry) throw new Error(`Unknown support ticket source: ${sourceModel}`);

    const [repository, adapter] = entry;
    const record = await repository.findById(sourceId);
    if (!record) return { skipped: `${sourceModel} ${sourceId} not found` };

    const ticket = await adapter(record);
    return { ticket: ticket?.reference || null };
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
