/**
 * Reel Convert Worker — makes an uploaded reel playable on every phone.
 *
 * Job: convert-reel { reelId } → services/reelConvertService.js convertReel.
 *
 * One job at a time per replica: an encode is CPU-bound for up to two minutes and
 * this process also serves the API. ffmpeg is a child process (the event loop is
 * never blocked) on two threads (config REEL_CONVERT_THREADS).
 *
 * Failure: an error marked `retry: false` (ffmpeg refused the file, the output
 * failed our check) fails the reel straight away; anything else is retried with
 * backoff and the reel is failed when the attempts run out. Either way the
 * uploader ends with a plain "choose a different video" message, never a reel
 * stuck in "processing".
 */
import { Worker, UnrecoverableError } from 'bullmq';
import * as Sentry from '@sentry/node';
import { createConnection } from '../connection.js';
import { convertReel, failConversion } from '../../services/reelConvertService.js';

/**
 * BullMQ renews the lock by itself while this process is alive (ffmpeg is a child
 * process, so the event loop stays free to do it). A short lock therefore only
 * matters when the process dies: the job is picked up again within about a minute.
 */
const LOCK_MS = 60 * 1000;

export async function processConvertJob(job, { convert = convertReel } = {}) {
  const reelId = String(job.data?.reelId || '');
  if (!reelId) throw new UnrecoverableError('convert-reel requires a reelId');
  try {
    return await convert(reelId);
  } catch (err) {
    // Tell BullMQ not to spend the remaining attempts on a file that cannot convert.
    if (err?.retry === false) throw new UnrecoverableError(err.message);
    throw err;
  }
}

export async function onConvertJobFailed(job, err, { fail = failConversion } = {}) {
  const final = err instanceof UnrecoverableError
    || err?.name === 'UnrecoverableError'
    || (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1);
  console.error(`[ReelConvertWorker] job ${job?.id} failed${final ? ' (final)' : ''}: ${err?.message}`);
  if (!final) return;

  const reelId = job?.data?.reelId;
  if (reelId) {
    await fail(reelId).catch((e) => console.error(`[ReelConvertWorker] could not mark ${reelId} failed: ${e.message}`));
  }
  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      scope.setContext('queue_job', { jobId: job?.id, jobName: job?.name, jobData: job?.data });
      Sentry.captureException(err);
    });
  }
}

export function startReelConvertWorker() {
  if (!process.env.REDIS_URL && !process.env.QUEUE_REDIS_URL) {
    console.warn('[ReelConvertWorker] no queue Redis configured — worker disabled');
    return null;
  }
  const worker = new Worker(
    'reel-convert',
    async (job) => {
      if (job.name !== 'convert-reel') throw new UnrecoverableError(`Unknown reel-convert job: ${job.name}`);
      return processConvertJob(job);
    },
    {
      connection: createConnection(),
      concurrency: 1,
      lockDuration: LOCK_MS,
      // A deploy kills the encode in hand (the container gets 25 s). That is a
      // "stalled" job, not a bad file: allow a few before BullMQ fails it.
      maxStalledCount: 3,
    },
  );
  worker.on('failed', (job, err) => { void onConvertJobFailed(job, err); });
  console.log('[ReelConvertWorker] Started');
  return worker;
}

export default { startReelConvertWorker, processConvertJob, onConvertJobFailed };
