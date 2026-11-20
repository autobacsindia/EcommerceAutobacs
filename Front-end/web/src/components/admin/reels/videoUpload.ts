/**
 * Direct browser → Cloudflare R2 VIDEO upload for reels (presigned by our backend).
 *
 * Videos never pass through Express or the /api proxy (which caps bodies at a
 * few MB). The backend picks the storage key and signs a one-time PUT for exactly
 * this file's type and size; no storage credential reaches the browser. We then
 * send only that key back to our API, which reads the real file and checks it
 * (MP4/MOV, H.264, ≤ 60 s, size). The checks here are for a fast, friendly
 * error — they are UX, not control.
 */
import apiClient from '@/lib/api-client';

export interface ReelUploadTarget {
  method: 'PUT';
  /** Presigned R2 URL. Bound to one key, one size, a short window. */
  uploadUrl: string;
  /** Headers to send with the PUT (the declared Content-Type). */
  headers?: Record<string, string>;
  /** The storage key — send it back as `publicId` when creating the reel. */
  publicId: string;
  contentType: string;
  expiresIn: number;
  maxBytes: number;
  maxDurationSec: number;
}

/** What the backend accepts. iPhone MOV files arrive as video/quicktime. */
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];

const TYPE_BY_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v' };

/**
 * The file's video type: the browser's label when it is one we take, else from the
 * extension (some browsers label an MOV as '' or application/octet-stream).
 * Null when it is not an MP4/MOV at all.
 */
export function videoTypeOf(file: Pick<File, 'type' | 'name'>): string | null {
  const t = (file.type || '').toLowerCase();
  if (ACCEPTED_VIDEO_TYPES.includes(t)) return t;
  if (t && t !== 'application/octet-stream') return null;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXT[ext] ?? null;
}

export const WRONG_TYPE_MESSAGE = 'Please pick an MP4 or MOV video.';

/** `team: true` asks for the shared team folder (staff upload); the backend decides whether to honour it. */
export const getReelUploadTarget = (file: File) =>
  apiClient.post('/reels/upload-signature', {
    team: true,
    contentType: videoTypeOf(file),
    size: file.size,
  }) as unknown as Promise<ReelUploadTarget>;

/** Reads the clip's length from its metadata. Resolves null if the browser can't tell. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve(null);
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (d: number | null) => { URL.revokeObjectURL(url); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

export function checkVideoFile(file: File, limits: Pick<ReelUploadTarget, 'maxBytes'>): string | null {
  if (!videoTypeOf(file)) return WRONG_TYPE_MESSAGE;
  if (limits.maxBytes && file.size > limits.maxBytes) {
    return `This video is too big. The limit is ${Math.floor(limits.maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}

/** Only ever PUT to an https URL the backend gave us. */
const isSafeUploadUrl = (url: string) => {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
};

/**
 * PUTs the raw file with XMLHttpRequest (not fetch) so staff see real progress on
 * a multi-megabyte clip. Resolves with the key to send back as `publicId`.
 */
export function uploadVideoToStorage(
  file: File,
  target: ReelUploadTarget,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ publicId: string }> {
  return new Promise((resolve, reject) => {
    if (!isSafeUploadUrl(target.uploadUrl)) {
      reject(new Error('Video upload is misconfigured. Please contact support.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.uploadUrl);
    for (const [k, v] of Object.entries(target.headers ?? { 'Content-Type': target.contentType })) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ publicId: target.publicId });
      else if (xhr.status === 403) reject(new Error('The upload link expired or the file changed. Please try again.'));
      else reject(new Error(`Video upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Video upload failed. Check the internet connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
