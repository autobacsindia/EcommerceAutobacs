/**
 * BullMQ Redis connection factory.
 *
 * BullMQ requires its own ioredis instances separate from the cache client:
 *  - maxRetriesPerRequest: null  (required by BullMQ — do not change)
 *  - Each Queue and Worker must receive its own connection instance
 *
 * Call createConnection() per Queue/Worker, not once shared.
 */

import { Redis } from 'ioredis';

export function createConnection() {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required for queue workers');
  }

  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,   // required by BullMQ
    enableReadyCheck: false,
    tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
  });
}
