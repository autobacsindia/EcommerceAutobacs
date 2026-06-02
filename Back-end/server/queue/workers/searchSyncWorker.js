/**
 * Search Sync Worker — keeps Elasticsearch in sync with MongoDB Product changes.
 *
 * Job names:
 *   es-sync-product  { productId }  — index or delete a product in ES
 *
 * The worker fetches the current committed document state from MongoDB on each
 * run, so it self-corrects for rolled-back transactions without any special
 * handling. Soft-deleted products (deletedAt !== null) are removed from the
 * index; all other active/inactive products are (re-)indexed so ES always
 * reflects what is in MongoDB.
 */

import { Worker } from 'bullmq';
import { createConnection } from '../connection.js';
import * as Sentry from '@sentry/node';
import elasticsearchService from '../../services/elasticsearchService.js';
import Product from '../../models/Product.js';

const handlers = {
  'es-sync-product': async (job) => {
    const { productId } = job.data;

    // Bypass the soft-delete pre-find hook so we can detect deleted products.
    const product = await Product
      .findById(productId, null, { includeDeleted: true })
      .populate('categories', 'name slug')
      .populate('compatibleVehicles', 'make model');

    if (!product || product.deletedAt !== null) {
      await elasticsearchService.deleteProduct(productId);
      console.log(`[SearchSync] Removed from index: ${productId}`);
    } else {
      await elasticsearchService.indexProduct(product);
      console.log(`[SearchSync] Indexed product: ${productId} (${product.name})`);
    }
  },
};

export function startSearchSyncWorker() {
  if (!process.env.REDIS_URL) {
    console.warn('[SearchSync] REDIS_URL not set — worker disabled');
    return null;
  }

  if (process.env.ELASTICSEARCH_ENABLED !== 'true') {
    console.log('[SearchSync] Elasticsearch disabled — worker not started');
    return null;
  }

  const worker = new Worker(
    'search-sync',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown search-sync job: ${job.name}`);
      return handler(job);
    },
    {
      connection: createConnection(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SearchSync] Job completed: ${job.id} (${job.name})`);
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[SearchSync] Job failed: ${job?.id} (${job?.name}) —`, err.message);
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('queue_job', { jobId: job?.id, jobName: job?.name, jobData: job?.data });
        Sentry.captureException(err);
      });
    }
  });

  console.log('[SearchSync] Started');
  return worker;
}
