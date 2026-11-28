/**
 * Direct browser → Cloudflare R2 VIDEO upload for reels (presigned by our backend).
 *
 * Videos never pass through Express or the /api proxy (which caps bodies at a
 * few MB). The backend picks the storage key and signs a one-time PUT for exactly
 * this file's type and size; no storage credential reaches the browser. We then
 * send only that key back to our API, which reads the real file and checks it
 * (MP4/MOV/3GP, H.264 + AAC, ≤ 60 s, size). The checks here are for a fast, friendly
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

/**
 * What the backend accepts (MP4-family containers it can check and every phone can
 * play). iPhone MOV files arrive as video/quicktime; Android 3GP as video/3gpp.
 */
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/3gpp2'];

const TYPE_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
};

/** Labels some browsers/OSes use for the same files. */
const TYPE_ALIASES: Record<string, string> = {
  'video/mov': 'video/quicktime', 'video/x-quicktime': 'video/quicktime', 'video/m4v': 'video/x-m4v',
  'audio/3gpp': 'video/3gpp', 'audio/3gpp2': 'video/3gpp2',
};

/** For the file input: the types AND the extensions, since some OSes only match on one. */
export const VIDEO_INPUT_ACCEPT = [...ACCEPTED_VIDEO_TYPES, ...Object.keys(TYPE_BY_EXT).map((e) => `.${e}`)].join(',');

/**
 * The file's video type: the browser's label when it is one we take, else from the
 * extension (some browsers label an MOV as '' or application/octet-stream).
 * Null when it is not something we take — WebM, MKV and AVI included: iPhones cannot
 * play those, so a reel made from one would be blank for them.
 */
export function videoTypeOf(file: Pick<File, 'type' | 'name'>): string | null {
  const raw = (file.type || '').toLowerCase().split(';')[0].trim();
  const t = TYPE_ALIASES[raw] ?? raw;
  if (ACCEPTED_VIDEO_TYPES.includes(t)) return t;
  if (t && t !== 'application/octet-stream' && t !== 'video/*') return null;
  const name = file.name || '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TYPE_BY_EXT[ext] ?? null;
}

export const WRONG_TYPE_MESSAGE = "This video format isn't supported — please record in MP4 or choose a different video.";

/** `team: true` asks for the shared team folder (staff upload); the backend decides whether to honour it. */
export const getReelUploadTarget = (file: File) =>
  apiClient.post('/reels/upload-signature', {
    team: true,
    contentType: videoTypeOf(file),
    size: file.size,
  }) as unknown as Promise<ReelUploadTarget>;

/**
 * Reads the clip's length from its metadata. Resolves null if the browser can't tell.
 * Never hangs: some browsers fire neither event for a file they cannot decode (e.g.
 * HEVC on desktop Chrome), so give up after `timeoutMs` and let the server check it.
 */
export function readVideoDuration(file: File, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve(null);
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      return resolve(null);
    }
    const v = document.createElement('video');
    let settled = false;
    const done = (d: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    v.preload = 'metadata';
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
      else reject(new Error('Video upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Video upload failed. Check the internet connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
