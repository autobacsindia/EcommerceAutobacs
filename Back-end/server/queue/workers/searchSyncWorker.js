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
import cacheService from '../../services/cacheService.js';
import Product from '../../models/Product.js';

// Bust the cached product listings/search responses that Redis serves. The
// mutation controller already fires this once, but that races the async ES
// index: a search during the worker's lag re-caches a result that predates this
// write for the full TTL. Re-invalidating HERE — after ES is refreshed and the
// doc is visible to search — guarantees the next search rebuilds from fresh ES.
// `*products*` covers the manual list cache (`v*:products:list:*`), facets, and
// the route/public listing caches (their keys carry the `/products` path).
async function invalidateProductCaches() {
  try {
    await cacheService.invalidatePattern('products');
  } catch (err) {
    console.warn('[SearchSync] Cache invalidation failed:', err.message);
  }
}

const handlers = {
  'es-sync-product': async (job) => {
    const { productId } = job.data;

    // Bypass the soft-delete pre-find hook so we can detect deleted products.
    const product = await Product
      .findById(productId, null, { includeDeleted: true })
      .populate('categories', 'name slug')
      .populate('compatibleVehicles', 'make model');

    // `refresh: 'wait_for'` makes ES resolve only once the change is searchable,
    // so the cache bust below can't re-cache a pre-index result.
    if (!product || product.deletedAt !== null) {
      await elasticsearchService.deleteProduct(productId, { refresh: 'wait_for' });
      console.log(`[SearchSync] Removed from index: ${productId}`);
    } else {
      await elasticsearchService.indexProduct(product, { refresh: 'wait_for' });
      console.log(`[SearchSync] Indexed product: ${productId} (${product.name})`);
    }

    // Only now — with ES authoritative — drop the stale cached listings.
    await invalidateProductCaches();
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
