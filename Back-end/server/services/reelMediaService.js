/**
 * Reel video handling on Cloudflare R2 (private bucket). Nothing here touches Cloudinary.
 *
 * ── VIDEO NEVER STREAMS THROUGH EXPRESS ──────────────────────────────────────────
 * The client asks for a presigned PUT to a key WE choose, uploads the file straight to
 * R2, and then sends us only that key. 100 MB uploads stay off the API process and off
 * the ~4.5 MB proxy body limit — the same pattern as careers and returns uploads
 * (services/storage/privateDirectUpload.js).
 *
 * ── WHY THE OBJECT IS RE-CHECKED BEFORE A REEL IS ACCEPTED ───────────────────────
 * Everything the client says about its upload is a claim. R2 does not enforce the
 * signed Content-Type, and the key in `POST /reels` could name anything. So
 * `verifyUploadedVideo` reads the real object back and checks, server-side:
 *   - the key is one we minted, inside the caller's own folder;
 *   - it exists and its stored size is ≤ the byte cap (HEAD);
 *   - its first bytes are an MP4/MOV container (magic-byte sniff);
 *   - its real length is ≤ 60s and its video is H.264 (`moov` read via ranged GETs,
 *     services/storage/mp4Probe.js).
 * Anything unreadable is REJECTED, never accepted unchecked. A rejected object is
 * deleted (best-effort) so refused uploads do not pile up.
 *
 * ── PLAYBACK ─────────────────────────────────────────────────────────────────────
 * The file is served as uploaded (no transcoding — the H.264 rule is what makes that
 * safe) through a presigned GET minted on every read. Not via img.autobacsindia.com:
 * that Worker serves image types only, on purpose.
 */
import {
  REEL_FOLDER,
  REEL_TEAM_FOLDER,
  REEL_MAX_BYTES,
  REEL_MAX_DURATION_SEC,
  REEL_DURATION_TOLERANCE_SEC,
  REEL_UPLOAD_TYPES,
  REEL_UPLOAD_SLOT,
  REEL_ALLOWED_CODECS,
  REEL_PLAYBACK_CONTENT_TYPE,
  REEL_PLAYBACK_TTL_SEC,
} from '../config/reels.js';
import { newFolder, buildKey, slotFromKey } from './storage/privateDirectUpload.js';
// Namespace import, not named: dozens of suites stub r2Provider with only the
// functions THEY use, and a named import of one they omit fails module linking for
// every test that loads the app — not just reels.
import * as r2 from './storage/r2Provider.js';
import { detectKind, KIND, SNIFF_BYTES } from './storage/contentSniff.js';
import { probeIsoMedia } from './storage/mp4Probe.js';
import AppError from '../utils/AppError.js';

const SCOPE = 'private';

/** Buyer-facing copy only (expose: true), so the error middleware passes it through. */
export class ReelMediaError extends AppError {
  constructor(message, status = 400, code = 'REEL_MEDIA_INVALID') {
    super(message, status, { expose: true });
    this.name = 'ReelMediaError';
    this.code = code;
  }
}

const unavailable = () => new ReelMediaError(
  'Video check is unavailable right now. Please try again shortly.', 503, 'REEL_MEDIA_UNAVAILABLE',
);

/** The prefix a given uploader may write into. Team uploads share one prefix. */
export const reelFolderFor = ({ userId, team = false }) =>
  (team ? REEL_TEAM_FOLDER : `${REEL_FOLDER}/u_${String(userId)}`);

const maxMb = () => Math.floor(REEL_MAX_BYTES / (1024 * 1024));

/** Extension of a key we minted, or ''. */
const extOf = (key) => {
  const m = /\.([a-z0-9]{2,5})$/.exec(key);
  return m ? m[1] : '';
};
const ALLOWED_EXTS = new Set(Object.values(REEL_UPLOAD_TYPES));

/**
 * A presigned PUT for one reel video, into a fresh folder under the caller's prefix.
 *
 * The exact byte size is signed into the URL, so an upload of any other size is
 * refused by R2 before it is stored. That stops an oversize file early; the HEAD at
 * submit is still the check of record.
 *
 * @returns {Promise<{ method, uploadUrl, headers, key, publicId, contentType, expiresIn, maxBytes, maxDurationSec }>}
 * @throws {ReelMediaError} 400 on a type we do not take or a missing/oversize size
 */
export async function buildUploadTarget({ userId, team = false, contentType, size }) {
  const type = String(contentType || '').trim().toLowerCase();
  const ext = REEL_UPLOAD_TYPES[type];
  if (!ext) {
    throw new ReelMediaError('Please choose an MP4 or MOV video.', 400, 'REEL_MEDIA_TYPE');
  }
  const bytes = Number(size);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new ReelMediaError('We could not read the video size. Please pick the video again.', 400, 'REEL_MEDIA_SIZE');
  }
  if (bytes > REEL_MAX_BYTES) {
    throw new ReelMediaError(`This video is too big. The limit is ${maxMb()} MB.`, 400, 'REEL_MEDIA_TOO_LARGE');
  }

  const folder = newFolder(reelFolderFor({ userId, team }));
  const key = buildKey({ folder, slot: REEL_UPLOAD_SLOT, ext });
  const { url: uploadUrl, expiresIn } = await r2.presignPut({
    key, scope: SCOPE, contentType: type, contentLength: bytes,
  });
  return {
    method: 'PUT',
    uploadUrl,
    headers: { 'Content-Type': type },
    key,
    // The contract's name for the asset id: send this back in `POST /reels`.
    publicId: key,
    contentType: type,
    expiresIn,
    maxBytes: REEL_MAX_BYTES,
    maxDurationSec: REEL_MAX_DURATION_SEC,
  };
}

/** Best-effort delete; a failure is logged by the provider, never thrown. */
export async function deleteReelVideo(key) {
  try {
    await r2.deleteObject({ key, scope: SCOPE });
  } catch (err) {
    console.error('[CLEANUP_REQUIRED][reels] could not delete video object', key, err?.message);
  }
}

/** Delete, then throw — every post-HEAD rejection goes through here. */
async function rejectAndDelete(key, message, code) {
  await deleteReelVideo(key);
  throw new ReelMediaError(message, 400, code);
}

/**
 * Confirm the uploaded object is a real, short, H.264 video in the caller's folder.
 * @returns {Promise<{ publicId, format, durationSec, bytes }>}
 * @throws {ReelMediaError}
 */
export async function verifyUploadedVideo(publicId, { folder }) {
  const key = typeof publicId === 'string' ? publicId.trim() : '';
  // Must be a key we minted, under THIS caller's prefix. slotFromKey matches the
  // whole key shape, so `u_1` cannot match `u_12` and `..` segments never pass.
  if (!key || slotFromKey(folder, key) !== REEL_UPLOAD_SLOT || !ALLOWED_EXTS.has(extOf(key))) {
    throw new ReelMediaError('That upload does not belong to you. Please upload the video again.', 403, 'REEL_MEDIA_FOREIGN');
  }

  let head;
  try {
    head = await r2.headObject({ key, scope: SCOPE });
  } catch {
    // Storage down/slow: not the user's fault, and not a reason to accept unchecked.
    throw unavailable();
  }
  if (!head) {
    throw new ReelMediaError('We could not find your uploaded video. Please upload it again.', 400, 'REEL_MEDIA_MISSING');
  }

  const bytes = Number(head.bytes) || 0;
  if (bytes > REEL_MAX_BYTES) {
    await rejectAndDelete(key, `This video is too big. The limit is ${maxMb()} MB.`, 'REEL_MEDIA_TOO_LARGE');
  }

  const readRange = (start, length) => r2.getObjectRange({ key, scope: SCOPE, start, length });

  let first;
  try {
    first = await readRange(0, SNIFF_BYTES);
  } catch {
    throw unavailable();
  }
  // ISO base media only (`ftyp` at offset 4): that is what MP4/MOV are, and what the
  // duration read below understands. WebM, AVI, HTML, images… are all refused here.
  const isIso = first.length >= 8 && first.toString('latin1', 4, 8) === 'ftyp';
  if (!isIso || detectKind(first) !== KIND.VIDEO) {
    await rejectAndDelete(key, 'Only MP4 or MOV videos can be posted as reels.', 'REEL_MEDIA_NOT_VIDEO');
  }

  let probe;
  try {
    probe = await probeIsoMedia(readRange, { size: bytes });
  } catch {
    throw unavailable();
  }
  if (!probe.ok) {
    // Fail CLOSED: a clip whose length we cannot read is not proven to be ≤ 60s.
    await rejectAndDelete(key, 'We could not read this video. Please try a different file.', 'REEL_MEDIA_UNREADABLE');
  }
  if (probe.durationSec > REEL_MAX_DURATION_SEC + REEL_DURATION_TOLERANCE_SEC) {
    await rejectAndDelete(key, `Reels can be at most ${REEL_MAX_DURATION_SEC} seconds long.`, 'REEL_MEDIA_TOO_LONG');
  }
  if (!probe.videoCodecs.every((c) => REEL_ALLOWED_CODECS.includes(c))) {
    await rejectAndDelete(
      key,
      'This video uses a format not every phone can play (often iPhone "High Efficiency"). '
        + 'On iPhone set Camera → Formats → Most Compatible, or export the video as H.264, then try again.',
      'REEL_MEDIA_CODEC',
    );
  }

  return {
    publicId: key,
    format: extOf(key),
    durationSec: Math.round(probe.durationSec * 10) / 10,
    bytes,
  };
}

/** Keys this service mints. Anything else (e.g. a legacy Cloudinary id) gets no URL. */
const PLAYABLE_KEY = new RegExp(
  `^${REEL_FOLDER}/(?:u_[0-9a-fA-F]{24}|team)/[0-9a-f]{24}/${REEL_UPLOAD_SLOT}-[0-9a-f]{16}\\.(?:${[...ALLOWED_EXTS].join('|')})$`,
);

const NO_URLS = Object.freeze({ hlsUrl: null, mp4Url: null, posterUrl: null });

/**
 * Playback URLs for a stored reel. `mp4Url` is a short-lived presigned GET that
 * serves the file as `video/mp4`; there is no HLS rendition or poster (no
 * transcoding). Never throws: a storage hiccup gives a reel with no video rather
 * than a feed that fails to load.
 *
 * @returns {Promise<{ hlsUrl: null, mp4Url: string|null, posterUrl: null }>}
 */
export async function reelPlaybackUrls(media) {
  const key = media?.publicId;
  if (typeof key !== 'string' || !PLAYABLE_KEY.test(key)) return { ...NO_URLS };
  try {
    const mp4Url = await r2.presignGet({
      key, scope: SCOPE, expiresIn: REEL_PLAYBACK_TTL_SEC, contentType: REEL_PLAYBACK_CONTENT_TYPE,
    });
    return { ...NO_URLS, mp4Url: mp4Url || null };
  } catch (err) {
    console.error('[reels] could not sign playback url', key, err?.message);
    return { ...NO_URLS };
  }
}

export default {
  buildUploadTarget, verifyUploadedVideo, deleteReelVideo, reelFolderFor, reelPlaybackUrls, ReelMediaError,
};
