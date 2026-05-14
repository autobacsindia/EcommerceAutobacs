/**
 * Queue singletons.
 *
 * Use getNotificationsQueue() / getOrderQueue() everywhere instead of
 * constructing Queue objects ad-hoc — each call to new Queue() opens a new
 * Redis connection.
 *
 * Queues are lazily created so tests that never touch Redis don't fail.
 */

import { Queue } from 'bullmq';
import { createConnection } from './connection.js';

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 86_400 },       // keep completed jobs 24 h
  removeOnFail:    { age: 7 * 86_400 },    // keep failed jobs 7 days
};

let notificationsQueue = null;
let orderQueue         = null;

export function getNotificationsQueue() {
  if (!notificationsQueue) {
    notificationsQueue = new Queue('notifications', {
      connection: createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return notificationsQueue;
}

export function getOrderQueue() {
  if (!orderQueue) {
    orderQueue = new Queue('order-processing', {
      connection: createConnection(),
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return orderQueue;
}

export async function closeQueues() {
  await Promise.all([
    notificationsQueue?.close(),
    orderQueue?.close(),
  ]);
}
