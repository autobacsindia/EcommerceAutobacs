/**
 * Playable URLs for a reel, DERIVED from its Cloudinary public id — never stored, so a
 * change of transformation (or of cloud) is a code change, not a data migration.
 *
 * Pure: no SDK call, no network. Built by hand rather than with `cloudinary.url()` so the
 * output is exactly the string below, testable without Cloudinary configured.
 *
 *   hlsUrl    — adaptive streaming (sp_auto). The SAME transformation is requested as an
 *               eager derivative at upload time (services/reelMediaService.js), so the
 *               first viewer does not wait for it to be transcoded.
 *   mp4Url    — progressive fallback, width-capped for phones.
 *   posterUrl — a still frame, shown before playback starts.
 */

/** Must equal the `eager` value signed in reelMediaService, or HLS is transcoded lazily. */
export const REEL_HLS_TRANSFORM = 'sp_auto';
export const REEL_EAGER = `${REEL_HLS_TRANSFORM}/m3u8`;
const MP4_TRANSFORM = 'c_limit,w_720,q_auto';

const cloudName = () => process.env.CLOUDINARY_CLOUD_NAME || '';

/** A public id we will build a URL from: our folder layout only, no traversal or query. */
const SAFE_PUBLIC_ID = /^[A-Za-z0-9_\-/]+$/;

/**
 * @param {{ publicId: string, version?: number, durationSec?: number }} media
 * @returns {{ hlsUrl: string, mp4Url: string, posterUrl: string } | null}
 */
export function reelMediaUrls(media) {
  const publicId = media?.publicId;
  if (!publicId || !SAFE_PUBLIC_ID.test(publicId) || publicId.includes('..')) return null;

  const base = `https://res.cloudinary.com/${cloudName()}/video/upload`;
  const v = Number.isInteger(media.version) && media.version > 0 ? `/v${media.version}` : '';
  // A very short clip has no frame at 1s; take the first frame instead.
  const offset = (media.durationSec ?? 0) >= 2 ? 'so_1' : 'so_0';

  return {
    hlsUrl: `${base}/${REEL_HLS_TRANSFORM}${v}/${publicId}.m3u8`,
    mp4Url: `${base}/${MP4_TRANSFORM}${v}/${publicId}.mp4`,
    posterUrl: `${base}/${offset},${MP4_TRANSFORM}${v}/${publicId}.jpg`,
  };
}

export default { reelMediaUrls, REEL_EAGER };
