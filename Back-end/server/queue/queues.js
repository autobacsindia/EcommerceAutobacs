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
let mediaQueue         = null;

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

/**
 * Image derivatives (AVIF/WebP variants) for freshly uploaded originals.
 *
 * A THIRD queue rather than a job name on `notifications`, for two reasons that
 * both bite in production:
 *   - resource profile. Encoding ~14 variants with sharp is CPU-bound and takes
 *     seconds; sharing a worker with order-confirmation emails would let a big
 *     gallery upload delay mail the customer is waiting on.
 *   - failure isolation. A variant job that keeps retrying against a missing
 *     object must not occupy the same attempt budget as the money path.
 *
 * Fewer attempts than the default, spaced further apart: the common failure is
 * "the browser has not finished its PUT yet", which needs patience, not speed.
 */
export function getMediaQueue() {
  if (!mediaQueue) {
    mediaQueue = new Queue('media', {
      connection: createConnection(),
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 5,
        backoff: { type: 'exponential', delay: 15_000 },
      },
    });
  }
  return mediaQueue;
}

/**
 * Ask for variants for a freshly uploaded original.
 *
 * Best-effort by design: variants are an OPTIMISATION, and the image Worker
 * already falls back to serving the original when one is missing. So a queue
 * outage must degrade to "larger images for a while", never to a failed upload
 * — which is why this swallows its errors like enqueueNotification does.
 *
 * `delayMs` exists because this is called when the presigned URL is ISSUED, not
 * when the browser finishes uploading. The object usually does not exist yet.
 * The worker re-checks and retries, so the delay is just to avoid burning the
 * first attempt on a certainty.
 */
export function enqueueVariantGeneration(key, { delayMs = 20_000 } = {}) {
  if (!process.env.REDIS_URL && !process.env.QUEUE_REDIS_URL) return;
  if (!key) return;
  try {
    getMediaQueue()
      .add('generate-variants', { key }, {
        delay: delayMs,
        // The key identifies the work completely, so a duplicate enqueue (a
        // retried signature request, a double-clicked save) collapses onto one
        // job instead of encoding everything twice.
        jobId: `variants:${key}`,
      })
      .catch((err) => console.error(`[Queue] variant enqueue failed for ${key}: ${err.message}`));
  } catch (err) {
    console.error(`[Queue] variant enqueue failed for ${key}: ${err.message}`);
  }
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
    mediaQueue?.close(),
  ]);
}
