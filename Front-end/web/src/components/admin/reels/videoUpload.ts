/**
 * Direct browser → Cloudinary VIDEO upload for reels (signed by our backend).
 *
 * Videos never pass through Express or the /api proxy (which caps bodies at a
 * few MB). The backend mints a short-lived signature for a fixed folder; the
 * API secret never reaches the browser. We only send the resulting public id
 * back to our API. Size and duration are checked here for a fast, friendly
 * error, but the backend re-checks the asset — these checks are UX, not control.
 */
import apiClient from '@/lib/api-client';

export interface ReelUploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  resourceType: 'video';
  maxBytes: number;
  maxDurationSec: number;
  /** Cloudinary upload endpoint for this cloud (backend-built). */
  uploadUrl?: string;
  /**
   * EVERY value the backend signed (folder, timestamp, allowed_formats, eager…).
   * They must be posted verbatim — changing or dropping one makes Cloudinary
   * reject the signature.
   */
  params?: Record<string, string | number>;
}

const CLOUDINARY_UPLOAD = /^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/video\/upload$/;

/** The upload target: the backend's URL when it is a Cloudinary video endpoint, else built from cloudName. */
export function uploadTarget(sig: Pick<ReelUploadSignature, 'cloudName' | 'uploadUrl'>): string {
  if (sig.uploadUrl && CLOUDINARY_UPLOAD.test(sig.uploadUrl)) return sig.uploadUrl;
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/video/upload`;
}

/** The signed fields to send: the backend's `params` verbatim, or folder + timestamp for the bare contract shape. */
export function signedFields(sig: Pick<ReelUploadSignature, 'folder' | 'timestamp' | 'params'>): [string, string][] {
  const base = sig.params && Object.keys(sig.params).length
    ? sig.params
    : { folder: sig.folder, timestamp: sig.timestamp };
  return Object.entries(base).map(([k, v]) => [k, String(v)]);
}

export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/** `team: true` asks for the shared team folder (staff upload); the backend decides whether to honour it. */
export const getReelUploadSignature = () =>
  apiClient.post('/reels/upload-signature', { team: true }) as unknown as Promise<ReelUploadSignature>;

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

export function checkVideoFile(file: File, sig: Pick<ReelUploadSignature, 'maxBytes'>): string | null {
  if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) return 'Please pick an MP4, MOV or WebM video.';
  if (sig.maxBytes && file.size > sig.maxBytes) {
    return `This video is too big. The limit is ${Math.floor(sig.maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}

/**
 * Uploads with XMLHttpRequest (not fetch) so staff see real progress on a
 * multi-megabyte clip. Returns Cloudinary's public id.
 */
export function uploadVideoToCloudinary(
  file: File,
  sig: ReelUploadSignature,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ publicId: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.apiKey);
    // Must match the signed values exactly, or Cloudinary rejects the signature.
    for (const [k, v] of signedFields(sig)) form.append(k, v);
    form.append('signature', sig.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadTarget(sig));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { public_id?: string; error?: { message?: string } } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.public_id) {
        resolve({ publicId: body.public_id });
      } else {
        reject(new Error(body.error?.message ? `Video upload failed: ${body.error.message}` : `Video upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Video upload failed. Check the internet connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}
