/**
 * Reel conversion — turn a clip not every phone can play (HEVC, H.263, AMR sound…)
 * into H.264 + AAC MP4, then let the reel continue to review.
 *
 * Flow for one reel in `processing` (queue/workers/reelConvertWorker.js calls this):
 *   1. download the original from the private bucket to a temp folder;
 *   2. ffmpeg → H.264/AAC MP4, longest side ≤ 1920, ≤ 30 fps, ≤ 60 s, metadata stripped
 *      (phones write GPS location into videos — it must not be published);
 *   3. re-check the RESULT with the same reader that checks uploads (mp4Probe). The
 *      output is trusted because it was verified, not because ffmpeg exited 0;
 *   4. upload it beside the original, under a key derived from the original's key;
 *   5. swap the reel onto it and move it to `pending` (customer) / `approved` (team)
 *      in ONE conditional update;
 *   6. delete the original.
 *
 * ── SAFE TO RUN TWICE ────────────────────────────────────────────────────────────
 * BullMQ retries, and a deploy can kill a job half way. The output key is a hash of
 * the original key, so a second run overwrites the same object instead of leaving a
 * stray. The swap only matches a reel that is still `processing` on the ORIGINAL key,
 * so a second run after a finished one changes nothing, and a reel staff removed
 * meanwhile is not resurrected.
 *
 * Errors: `ReelConvertError` with `retry: false` means "this file will never
 * convert" (the worker fails the reel at once); anything else is retried.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as r2 from './storage/r2Provider.js';
import { probeIsoMedia } from './storage/mp4Probe.js';
import reelRepository from '../repositories/reelRepository.js';
import { enqueueReelConversion, reelConvertJobId } from '../queue/queues.js';
import {
  REEL_STATUS,
  REEL_CONVERT_STATE,
  REEL_CONVERT_TIMEOUT_MS,
  REEL_CONVERT_MAX_SIDE,
  REEL_CONVERT_THREADS,
  REEL_CONVERT_FAILED_MESSAGE,
  REEL_CONVERT_STUCK_AFTER_MS,
  REEL_CONVERT_GIVE_UP_AFTER_MS,
  REEL_ALLOWED_CODECS,
  REEL_ALLOWED_AUDIO_CODECS,
  REEL_MAX_BYTES,
  REEL_MAX_DURATION_SEC,
  REEL_DURATION_TOLERANCE_SEC,
  REEL_UPLOAD_SLOT,
  REEL_PLAYBACK_CONTENT_TYPE,
} from '../config/reels.js';

const SCOPE = 'private';

export class ReelConvertError extends Error {
  constructor(message, { retry = true } = {}) {
    super(message);
    this.name = 'ReelConvertError';
    this.retry = retry;
  }
}

/**
 * Where the converted copy of `originalKey` goes: same folder, same slot, `.mp4`,
 * with a name derived from the original so a retry writes the same object. Still
 * the `<prefix>/<24hex>/video-<16hex>.mp4` shape every reel key has.
 */
export function convertedKeyFor(originalKey) {
  const dir = path.posix.dirname(String(originalKey));
  const id = crypto.createHash('sha256').update(String(originalKey)).digest('hex').slice(0, 16);
  return `${dir}/${REEL_UPLOAD_SLOT}-${id}.mp4`;
}

/** ffmpeg arguments. Pure, so the exact command is unit-tested. */
export function ffmpegArgs(input, output) {
  const side = REEL_CONVERT_MAX_SIDE;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', input,
    // First picture track and (if there is one) first sound track; no subtitles/data.
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-map_metadata', '-1', '-map_chapters', '-1',
    // Shrink only: cap the longer side, keep the shape, even dimensions for H.264.
    '-vf', `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`,
    '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-t', String(REEL_MAX_DURATION_SEC),
    '-threads', String(REEL_CONVERT_THREADS),
    // moov at the front, so playback starts before the whole file is downloaded.
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
}

/** Run ffmpeg with a hard time limit. Resolves on exit 0, rejects otherwise. */
export function runFfmpeg(args, { timeoutMs = REEL_CONVERT_TIMEOUT_MS, bin = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new ReelConvertError(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    // ENOENT here = ffmpeg is not installed in this image. Retrying cannot help, but
    // the next deploy can, so it stays retryable and the sweep keeps the reel alive.
    child.on('error', (err) => finish(reject, new ReelConvertError(`ffmpeg could not start: ${err.message}`)));
    child.on('close', (code, signal) => {
      if (code === 0) return finish(resolve);
      // Killed from outside (deploy, out of memory): try again. A clean non-zero
      // exit means ffmpeg read the file and refused it: it never will convert.
      const retry = code === null;
      finish(reject, new ReelConvertError(`ffmpeg failed (${signal || `exit ${code}`}): ${stderr.trim().slice(0, 500)}`, { retry }));
    });
  });
}

/** `readRange` over a local file, for mp4Probe. */
const fileReader = (filePath) => async (start, length) => {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
};

/** The converted file must itself pass the rules an upload has to pass. */
export async function checkConverted(filePath) {
  const { size } = await fs.promises.stat(filePath);
  if (!size || size > REEL_MAX_BYTES) throw new ReelConvertError(`converted file has a bad size (${size})`, { retry: false });
  const probe = await probeIsoMedia(fileReader(filePath), { size });
  const audio = probe.audioCodecs ?? [];
  const ok = probe.ok
    && probe.videoCodecs.length > 0
    && probe.videoCodecs.every((c) => REEL_ALLOWED_CODECS.includes(c))
    && audio.every((c) => REEL_ALLOWED_AUDIO_CODECS.includes(c))
    && probe.durationSec > 0
    && probe.durationSec <= REEL_MAX_DURATION_SEC + REEL_DURATION_TOLERANCE_SEC;
  if (!ok) {
    throw new ReelConvertError(
      `converted file failed the check (video ${probe.videoCodecs?.join('+') || 'none'}, audio ${audio.join('+') || 'none'}, ${probe.durationSec}s)`,
      { retry: false },
    );
  }
  return { bytes: size, durationSec: Math.round(probe.durationSec * 10) / 10 };
}

const waiting = (reel) =>
  reel?.status === REEL_STATUS.PROCESSING && reel.media?.convert === REEL_CONVERT_STATE.PENDING;

/**
 * Convert one reel. Idempotent — see the header.
 * @returns {Promise<{ converted: true, key: string } | { skipped: string }>}
 */
export async function convertReel(reelId, { run = runFfmpeg, storage = r2, now = () => new Date() } = {}) {
  const reel = await reelRepository.findForConversion(reelId);
  if (!reel) return { skipped: 'not-found' };
  if (!waiting(reel)) return { skipped: 'not-waiting' };

  const originalKey = reel.media.publicId;
  const outKey = convertedKeyFor(originalKey);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-convert-'));
  const input = path.join(dir, 'in');
  const output = path.join(dir, 'out.mp4');

  try {
    const head = await storage.headObject({ key: originalKey, scope: SCOPE });
    // Checked at upload, so a missing original means it was deleted since: nothing to convert.
    if (!head) throw new ReelConvertError('the original video is no longer in storage', { retry: false });
    if (head.bytes > REEL_MAX_BYTES) throw new ReelConvertError('the original video is over the size limit', { retry: false });

    await storage.downloadToFile({ key: originalKey, scope: SCOPE, filePath: input });
    await run(ffmpegArgs(input, output));
    const checked = await checkConverted(output);
    await storage.putFile({ filePath: output, key: outKey, scope: SCOPE, contentType: REEL_PLAYBACK_CONTENT_TYPE });

    const at = now();
    const team = reel.source === 'team';
    const updated = await reelRepository.transition(
      reelId,
      [REEL_STATUS.PROCESSING],
      {
        'media.publicId': outKey,
        'media.format': 'mp4',
        'media.bytes': checked.bytes,
        'media.durationSec': checked.durationSec,
        status: team ? REEL_STATUS.APPROVED : REEL_STATUS.PENDING,
        // A team upload goes live as it would have without the detour.
        ...(team ? { approvedAt: at, moderatedAt: at, moderatedBy: reel.uploadedBy } : {}),
      },
      { where: { 'media.publicId': originalKey, 'media.convert': REEL_CONVERT_STATE.PENDING }, unset: { 'media.convert': 1 } },
    );

    if (!updated) {
      // Removed by staff, or already swapped by an earlier run, while we encoded.
      const current = await reelRepository.findForConversion(reelId);
      if (current?.media?.publicId !== outKey) {
        await storage.deleteObject({ key: outKey, scope: SCOPE }).catch(() => {});
      }
      return { skipped: 'changed-meanwhile' };
    }

    await storage.deleteObject({ key: originalKey, scope: SCOPE })
      .catch((err) => console.error('[CLEANUP_REQUIRED][reels] could not delete original after conversion', originalKey, err?.message));
    console.log(`[reels] ${reelId} converted → ${outKey} (${(checked.bytes / 1048576).toFixed(1)} MB, ${checked.durationSec}s)`);
    return { converted: true, key: outKey };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Give up on a reel: it becomes `rejected` with a plain reason, keeps `convert:
 * 'failed'` (which blocks approval for good) and its unplayable original is deleted.
 * No-op unless the reel is still waiting, so it is safe to call twice.
 * @returns {Promise<boolean>} true when this call failed the reel
 */
export async function failConversion(reelId, { storage = r2, now = () => new Date() } = {}) {
  const updated = await reelRepository.transition(
    reelId,
    [REEL_STATUS.PROCESSING],
    {
      status: REEL_STATUS.REJECTED,
      rejectReason: REEL_CONVERT_FAILED_MESSAGE,
      moderatedAt: now(),
      'media.convert': REEL_CONVERT_STATE.FAILED,
    },
    { where: { 'media.convert': REEL_CONVERT_STATE.PENDING } },
  );
  if (!updated) return false;
  await storage.deleteObject({ key: updated.media.publicId, scope: SCOPE }).catch(() => {});
  return true;
}

/**
 * Safety net for reels left in `processing`: the enqueue failed (queue Redis down),
 * or a deploy killed the job more often than BullMQ forgives. Anything waiting
 * longer than a normal conversion is queued again; anything waiting for hours is
 * failed, so nobody stares at "processing" forever.
 *
 * Bounded (oldest `limit` rows, one indexed read). The job id carries the time
 * slot so a re-queue is a NEW job (a failed job keeps its id for 7 days) while two
 * sweeps in the same slot still collapse onto one.
 */
export async function sweepStuckConversions({ now = new Date(), limit = 50, enqueue = enqueueReelConversion, fail = failConversion } = {}) {
  const rows = await reelRepository.findOlderInStatus({
    status: REEL_STATUS.PROCESSING,
    before: new Date(now.getTime() - REEL_CONVERT_STUCK_AFTER_MS),
    limit,
  });
  const giveUpBefore = now.getTime() - REEL_CONVERT_GIVE_UP_AFTER_MS;
  const slot = Math.floor(now.getTime() / REEL_CONVERT_STUCK_AFTER_MS);
  let requeued = 0;
  let failed = 0;
  for (const row of rows) {
    if (new Date(row.createdAt).getTime() < giveUpBefore) {
      if (await fail(row._id)) failed += 1;
    } else if (await enqueue(row._id, { jobId: reelConvertJobId(row._id, 'sweep', slot) })) {
      requeued += 1;
    }
  }
  return { stuck: rows.length, requeued, failed };
}

export default { sweepStuckConversions, convertReel, failConversion, convertedKeyFor, ffmpegArgs, runFfmpeg, checkConverted, ReelConvertError };
