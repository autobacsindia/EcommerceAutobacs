/**
 * Which picked videos we can post as reels — pure, so it is unit-tested with node.
 *
 * The server only takes MP4-family files (MP4, MOV, M4V, 3GP, 3G2) and then checks
 * the real bytes: H.264 video, AAC sound, ≤ 60 s. Those play on every iPhone and
 * Android phone and in every browser without converting them. WebM, MKV and AVI are
 * refused up front: iPhones cannot play them, so the reel would be blank for them.
 *
 * Pickers are messy: gallery picks often come back with no MIME type, a generic
 * `application/octet-stream`, or no file extension at all. With nothing to go on we
 * say MP4 and let the server's byte check decide — it refuses anything else with
 * the same plain message, never a crash.
 */

export type ReelVideoType = 'video/mp4' | 'video/quicktime' | 'video/x-m4v' | 'video/3gpp' | 'video/3gpp2';

export const UNSUPPORTED_VIDEO_MESSAGE =
  "This video format isn't supported — please record in MP4 or choose a different video.";

export interface PickedVideoLike {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

const BY_MIME: Record<string, ReelVideoType> = {
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'video/mov': 'video/quicktime',
  'video/x-quicktime': 'video/quicktime',
  'video/x-m4v': 'video/x-m4v',
  'video/m4v': 'video/x-m4v',
  'video/3gpp': 'video/3gpp',
  'audio/3gpp': 'video/3gpp',
  'video/3gpp2': 'video/3gpp2',
  'audio/3gpp2': 'video/3gpp2',
};

const BY_EXT: Record<string, ReelVideoType> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
};

/** Labels that say nothing about the format — fall back to the name. */
const GENERIC = new Set(['', 'video/*', 'application/octet-stream', 'binary/octet-stream']);

/** Extension of the file name (or of the uri's last path segment), lower-case, or ''. */
function extOf(video: PickedVideoLike): string {
  const raw = (video.fileName || video.uri || '').split(/[?#]/)[0];
  const last = raw.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

/** The type to upload as, or null for a format we cannot take. */
export function reelVideoType(video: PickedVideoLike): ReelVideoType | null {
  const mime = (video.mimeType || '').toLowerCase().split(';')[0].trim();
  if (BY_MIME[mime]) return BY_MIME[mime];
  if (!GENERIC.has(mime)) return null; // a real label we do not take (video/webm, video/x-matroska, image/…)
  const ext = extOf(video);
  if (BY_EXT[ext]) return BY_EXT[ext];
  // No usable label AND no extension (common for Android gallery content:// picks):
  // try MP4 — the server reads the bytes and refuses anything else politely.
  return ext ? null : 'video/mp4';
}

/**
 * Turn whatever a picker / permission call threw into words for the person.
 * Never returns empty. Raw native messages ("Failed to export…", codes) are not shown.
 */
export function pickerErrorText(err: unknown): string {
  const msg = String((err as { message?: unknown } | null)?.message ?? '').toLowerCase();
  if (msg.includes('permission') || msg.includes('denied')) {
    return 'Please allow Autobacs to use your camera and videos in Settings, then try again.';
  }
  if (msg.includes('export') || msg.includes('transcod') || msg.includes('format') || msg.includes('codec')) {
    return UNSUPPORTED_VIDEO_MESSAGE;
  }
  return "We couldn't open that video. Please try again, or choose a different video.";
}
