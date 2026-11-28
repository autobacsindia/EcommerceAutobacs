/**
 * Reels — the steps of one video upload, with the phone-specific parts
 * (reading the file's size, sending its bytes) passed in. Pure, so it runs
 * under `npm test` without a phone.
 *
 * Why the bytes are sent by the native uploader and never through
 * `fetch(uri).blob()`: on Android (Expo Go, SDK 58) the picker hands back a
 * file:// URI whose folder name is itself URL-encoded (`%2540anonymous…`).
 * `fetch` decodes it a second time, misses the file and answers with a
 * 14-byte "File not found" body instead of failing. That body was signed and
 * uploaded as the "video", so the server's check refused every camera clip.
 * The native uploader opens the file by path, and the size comes from the
 * file system, so a wrong read can no longer pass as a video.
 */
import type { ReelVideoType } from './videoType';

export const UNREADABLE_VIDEO_MESSAGE = 'We could not read this video. Please pick it again.';

/**
 * The smallest file we treat as a real video. Even a one-frame MP4 is several
 * hundred bytes (ftyp + moov); anything smaller is an error text or an empty
 * file, which must never be uploaded as a reel.
 */
export const MIN_VIDEO_BYTES = 1024;

export interface ReelUploadTarget {
  uploadUrl: string;
  headers: Record<string, string>;
  publicId: string;
  maxBytes: number;
}

export interface ReelUploadIO {
  /** Byte size of the local file, or null when it does not exist. */
  fileSize(uri: string): Promise<number | null>;
  getTarget(input: { contentType: ReelVideoType; size: number }): Promise<ReelUploadTarget>;
  /** PUT the file's raw bytes; resolves with the HTTP status. */
  put(
    url: string,
    uri: string,
    headers: Record<string, string>,
    onProgress: (fraction: number) => void,
  ): Promise<{ status: number }>;
  isCancelled(): boolean;
}

export const cancelledError = () => new Error('Upload cancelled.');

export async function runReelUpload(
  io: ReelUploadIO,
  uri: string,
  contentType: ReelVideoType,
  onProgress: (fraction: number) => void,
): Promise<{ publicId: string }> {
  let size: number | null;
  try {
    size = await io.fileSize(uri);
  } catch {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  if (size == null || !Number.isFinite(size) || size < MIN_VIDEO_BYTES) {
    throw new Error(UNREADABLE_VIDEO_MESSAGE);
  }
  if (io.isCancelled()) throw cancelledError();

  const target = await io.getTarget({ contentType, size });
  if (size > target.maxBytes) {
    throw new Error(`Please choose a video under ${Math.floor(target.maxBytes / (1024 * 1024))} MB.`);
  }
  if (io.isCancelled()) throw cancelledError();

  let status: number;
  try {
    ({ status } = await io.put(target.uploadUrl, uri, target.headers, (f) =>
      onProgress(Math.min(0.99, Math.max(0, f))),
    ));
  } catch (err) {
    if (io.isCancelled()) throw cancelledError();
    throw new Error('Upload failed — check your internet and try again.', { cause: err });
  }
  if (io.isCancelled()) throw cancelledError();
  if (status < 200 || status >= 300) throw new Error(`Upload failed (${status}). Please try again.`);

  onProgress(1);
  return { publicId: target.publicId };
}
