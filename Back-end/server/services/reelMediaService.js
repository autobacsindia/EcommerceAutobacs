/**
 * Reel video handling against Cloudinary.
 *
 * ── VIDEO NEVER STREAMS THROUGH EXPRESS ──────────────────────────────────────────
 * The client asks for a short-lived signature, uploads the file straight to Cloudinary,
 * and then sends us only the resulting public id. That keeps 100 MB uploads off the API
 * process (and off the ~4.5 MB proxy body limit) entirely.
 *
 * ── WHY THE ASSET IS RE-CHECKED BEFORE A REEL IS ACCEPTED ────────────────────────
 * Everything the client says about its upload is a claim. The signature pins the folder
 * and formats, but Cloudinary has no signed "max duration" or "max bytes" parameter, and
 * the public id in `POST /reels` could name anything. So `verifyUploadedVideo` asks
 * Cloudinary's Admin API for the real asset and checks, server-side:
 *   - it exists, and is a video;
 *   - it sits in the caller's own folder (so nobody can claim someone else's upload);
 *   - its duration is known and ≤ 60s, and its size ≤ the byte cap.
 * An asset that fails is deleted (best-effort) so rejected uploads do not pile up.
 */
import cloudinary from '../config/cloudinary.js';
import {
  REEL_ALLOWED_FORMATS,
  REEL_FOLDER,
  REEL_TEAM_FOLDER,
  REEL_MAX_BYTES,
  REEL_MAX_DURATION_SEC,
  REEL_DURATION_TOLERANCE_SEC,
} from '../config/reels.js';
import { REEL_EAGER } from '../utils/reelMedia.js';
import AppError from '../utils/AppError.js';

/** Buyer-facing copy only (expose: true), so the error middleware passes it through. */
export class ReelMediaError extends AppError {
  constructor(message, status = 400, code = 'REEL_MEDIA_INVALID') {
    super(message, status, { expose: true });
    this.name = 'ReelMediaError';
    this.code = code;
  }
}

/** The folder a given uploader may write into. Team uploads share one folder. */
export const reelFolderFor = ({ userId, team = false }) =>
  (team ? REEL_TEAM_FOLDER : `${REEL_FOLDER}/u_${String(userId)}`);

/**
 * Signed params for a direct client → Cloudinary video upload.
 *
 * The client must POST every entry of `params` VERBATIM (plus `file`, `api_key` and
 * `signature`) to `uploadUrl` — they are exactly the values that were signed; changing
 * one makes Cloudinary reject the upload.
 */
export function buildUploadSignature({ userId, team = false, now = Date.now() }) {
  const folder = reelFolderFor({ userId, team });
  const timestamp = Math.round(now / 1000);
  const params = {
    allowed_formats: REEL_ALLOWED_FORMATS.join(','),
    eager: REEL_EAGER,
    eager_async: 'true',
    folder,
    timestamp: String(timestamp),
  };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  return {
    cloudName,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    folder,
    resourceType: 'video',
    maxBytes: REEL_MAX_BYTES,
    maxDurationSec: REEL_MAX_DURATION_SEC,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
    params,
  };
}

/** Best-effort delete; a failure is logged, never thrown (it must not mask the real error). */
export async function deleteReelVideo(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true });
  } catch (err) {
    console.error('[reels] could not delete video asset', publicId, err?.message);
  }
}

const durationOf = (res) => {
  const candidates = [res?.duration, res?.video_metadata?.format?.duration, res?.video_metadata?.duration];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

/**
 * Confirm the uploaded asset is a real video, in `folder`, within the caps.
 * @returns {Promise<{ publicId, version, format, durationSec, bytes, width, height }>}
 * @throws {ReelMediaError}
 */
export async function verifyUploadedVideo(publicId, { folder }) {
  const id = typeof publicId === 'string' ? publicId.trim() : '';
  // Must sit INSIDE the caller's folder: the trailing slash stops `u_1` matching `u_12`.
  if (!id || !id.startsWith(`${folder}/`) || id.includes('..')) {
    throw new ReelMediaError('That upload does not belong to you. Please upload the video again.', 403, 'REEL_MEDIA_FOREIGN');
  }

  let res;
  try {
    res = await cloudinary.api.resource(id, { resource_type: 'video', media_metadata: true });
  } catch (err) {
    const code = err?.http_code ?? err?.error?.http_code;
    if (code === 404) {
      throw new ReelMediaError('We could not find your uploaded video. Please upload it again.', 400, 'REEL_MEDIA_MISSING');
    }
    // Cloudinary down/slow: not the user's fault, and not a reason to accept unchecked.
    throw new ReelMediaError('Video check is unavailable right now. Please try again shortly.', 503, 'REEL_MEDIA_UNAVAILABLE');
  }

  if (res?.resource_type !== 'video') {
    await deleteReelVideo(id);
    throw new ReelMediaError('Only video files can be posted as reels.', 400, 'REEL_MEDIA_NOT_VIDEO');
  }

  const durationSec = durationOf(res);
  if (durationSec === null) {
    // Fail CLOSED: a clip whose length we cannot read is not proven to be ≤ 60s.
    await deleteReelVideo(id);
    throw new ReelMediaError('We could not read this video. Please try a different file.', 400, 'REEL_MEDIA_UNREADABLE');
  }
  if (durationSec > REEL_MAX_DURATION_SEC + REEL_DURATION_TOLERANCE_SEC) {
    await deleteReelVideo(id);
    throw new ReelMediaError(`Reels can be at most ${REEL_MAX_DURATION_SEC} seconds long.`, 400, 'REEL_MEDIA_TOO_LONG');
  }
  const bytes = Number(res.bytes) || 0;
  if (bytes > REEL_MAX_BYTES) {
    await deleteReelVideo(id);
    throw new ReelMediaError('This video file is too large.', 400, 'REEL_MEDIA_TOO_LARGE');
  }

  return {
    publicId: id,
    version: Number.isInteger(res.version) ? res.version : undefined,
    format: res.format,
    durationSec: Math.round(durationSec * 10) / 10,
    bytes,
    width: Number(res.width) || undefined,
    height: Number(res.height) || undefined,
  };
}

export default { buildUploadSignature, verifyUploadedVideo, deleteReelVideo, reelFolderFor, ReelMediaError };
