/**
 * BullMQ Redis connection factory.
 *
 * BullMQ requires its own ioredis instances separate from the cache client:
 *  - maxRetriesPerRequest: null  (required by BullMQ — do not change)
 *  - Each Queue and Worker must receive its own connection instance
 *
 * Call createConnection() per Queue/Worker, not once shared.
 *
 * Redis split (see plan): BullMQ uses blocking commands + constant polling, which is
 * expensive/fragile on Upstash's per-request serverless model. It runs on a dedicated
 * Redis via QUEUE_REDIS_URL. Falls back to REDIS_URL so single-instance/dev still works.
 */

import { Redis } from 'ioredis';

const QUEUE_URL = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;

export function createConnection() {
  if (!QUEUE_URL) {
    throw new Error('QUEUE_REDIS_URL (or REDIS_URL fallback) is required for queue workers');
  }

  return new Redis(QUEUE_URL, {
    maxRetriesPerRequest: null,   // required by BullMQ
    enableReadyCheck: false,
    tls: QUEUE_URL.startsWith('rediss://') ? {} : undefined,
  });
}
