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
let searchSyncQueue    = null;

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

export function getSearchSyncQueue() {
  if (!searchSyncQueue) {
    searchSyncQueue = new Queue('search-sync', {
      connection: createConnection(),
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  return searchSyncQueue;
}

/**
 * Fire-and-forget enqueue onto the notifications queue. Best-effort by design:
 * a Redis/queue outage must never break the originating HTTP request, so a
 * missing queue Redis is a silent no-op and enqueue errors are logged and
 * swallowed. Use for non-critical alerts (e.g. admin notifications), NOT for
 * work that must not be lost.
 */
export function enqueueNotification(jobName, data) {
  if (!process.env.REDIS_URL && !process.env.QUEUE_REDIS_URL) return;
  try {
    getNotificationsQueue()
      .add(jobName, data)
      .catch((err) => console.error(`[Queue] Failed to enqueue ${jobName}:`, err.message));
  } catch (err) {
    console.error(`[Queue] Failed to enqueue ${jobName}:`, err.message);
  }
}

export async function closeQueues() {
  await Promise.all([
    notificationsQueue?.close(),
    orderQueue?.close(),
    searchSyncQueue?.close(),
  ]);
}
