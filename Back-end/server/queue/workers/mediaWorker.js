/**
 * Media Worker — renders AVIF/WebP variants for freshly uploaded originals.
 *
 * Job names:
 *   generate-variants  { key }   — one public-bucket original
 *
 * ── Why this is enqueued from the SIGNATURE endpoint ────────────────────────
 * Uploads go browser → R2 directly, so the server never sees the bytes. It could
 * enqueue from each controller that persists an image ref instead — but that is
 * seven-plus call sites (products, blog, banners, brands, categories, vehicles,
 * spin), and one missed site is a silent gap where images quietly serve at full
 * size forever. Exactly that shape of bug has already cost this migration once.
 * `POST /uploads/signature` is the single point every PUBLIC direct upload
 * passes through, so it is where the job is raised.
 *
 * The cost of that choice: at enqueue time the object does not exist yet, and
 * might never — the browser can fail, or the admin can abandon the form. So the
 * worker treats "not there yet" as a RETRY and eventually gives up quietly.
 * Missing variants are not an outage: the image Worker falls back to serving the
 * original with a short cache, so the failure mode is a larger image, and a
 * later backfill (`npm run generate-image-variants`) sweeps up anything missed.
 */

import { Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { createConnection } from '../connection.js';
import { headObject, getObjectBuffer, listKeys } from '../../services/storage/r2Provider.js';
import { generateVariants } from '../../services/storage/variantGenerator.js';
import { VARIANT_PREFIX, variantPrefixFor } from '../../services/storage/variants.js';
import { putObject } from '../../services/storage/r2Provider.js';
import { scopeFor } from '../../services/storage/assetScope.js';

/**
 * Content types we will decode. The bucket is public and the upload endpoint
 * signs only image types, but this worker downloads and hands bytes to sharp —
 * so it re-checks rather than trusting that, since R2 does not enforce the
 * Content-Type a URL was signed with.
 */
const RENDERABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif']);

class ObjectNotReadyError extends Error {}

const handlers = {
  'generate-variants': async (job) => {
    const key = String(job.data?.key || '');
    if (!key) throw new Error('generate-variants requires a key');

    /*
      Never render for anything outside the public tree. A private asset (a CV, a
      return video) must not acquire public derivatives — that would defeat the
      entire point of the two-bucket split.
    */
    if (scopeFor(key) !== 'public') {
      console.warn(`[MediaWorker] refusing non-public key: ${key}`);
      return { skipped: 'not-public' };
    }
    // A variant is itself an original-shaped object; rendering one would recurse.
    if (key.startsWith(`${VARIANT_PREFIX}/`)) return { skipped: 'is-variant' };

    const head = await headObject({ key, scope: 'public' });
    if (!head) {
      // The browser has not finished its PUT — or never will. Retrying is the
      // whole reason this job has a long backoff.
      throw new ObjectNotReadyError(`object not present yet: ${key}`);
    }

    const type = String(head.contentType || '').split(';')[0].trim().toLowerCase();
    if (!RENDERABLE.has(type)) {
      console.warn(`[MediaWorker] not a renderable image (${type || 'unknown'}): ${key}`);
      return { skipped: 'not-an-image' };
    }

    const buffer = await getObjectBuffer({ key, scope: 'public' });

    /*
      One listing instead of a HEAD per planned variant. Measured during the
      backfill: the per-variant probes were ~half the round trips and the job was
      75% idle waiting on them.
    */
    const existing = await listKeys({ prefix: variantPrefixFor(key), scope: 'public' });
    const existingKeys = new Set(existing.map((o) => o.key));

    const res = await generateVariants({ buffer, originalKey: key, putObject, existingKeys });
    console.log(
      `[MediaWorker] ${key} → ${res.written} written, ${res.skipped} already present, ` +
      `${res.failed.length} failed (${(res.bytes / 1024).toFixed(0)} KB)`,
    );
    // Surface partial failure so the job retries rather than reporting success
    // for a half-rendered ladder.
    if (res.failed.length) throw new Error(`${res.failed.length} variant(s) failed for ${key}`);
    return { written: res.written, skipped: res.skipped };
  },
};

export function startMediaWorker() {
  if (!process.env.REDIS_URL && !process.env.QUEUE_REDIS_URL) {
    console.warn('[MediaWorker] no queue Redis configured — worker disabled');
    return null;
  }

  const worker = new Worker(
    'media',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown media job: ${job.name}`);
      return handler(job);
    },
    {
      connection: createConnection(),
      /*
        Deliberately low. sharp already uses a thread pool per encode, so running
        many jobs at once oversubscribes the CPU on a small Railway instance and
        starves the HTTP server that shares it. Variants are never urgent.
      */
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    const attemptsLeft = (job?.opts?.attempts ?? 1) - (job?.attemptsMade ?? 0);

    /*
      An upload that never completed is an ordinary, expected outcome — an admin
      closed the tab, a phone lost signal. Paging on it would train everyone to
      ignore this queue, so it is logged and dropped once the retries are spent.
      Anything else is a real fault and goes to Sentry.
    */
    if (err instanceof ObjectNotReadyError || err?.name === 'ObjectNotReadyError') {
      if (attemptsLeft <= 0) {
        console.warn(`[MediaWorker] giving up on ${job?.data?.key} — upload never completed`);
      }
      return;
    }

    console.error(`[MediaWorker] job failed: ${job?.id} —`, err.message);
    if (process.env.SENTRY_DSN && attemptsLeft <= 0) {
      Sentry.withScope((scope) => {
        scope.setContext('queue_job', { jobId: job?.id, jobName: job?.name, jobData: job?.data });
        Sentry.captureException(err);
      });
    }
  });

  console.log('[MediaWorker] Started');
  return worker;
}

export default { startMediaWorker };
