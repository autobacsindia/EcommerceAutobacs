/**
 * Direct browser → Cloudinary image upload (signed).
 *
 * Why: routing image bytes through our /api proxy caps a request at ~4.5 MB
 * (Vercel edge), so a multi-image product can't carry a full gallery. Instead
 * the browser uploads each file straight to Cloudinary — no proxy in the byte
 * path, no size ceiling — using a short-lived signature minted by our backend
 * (the API secret never reaches the client). The form then submits only the
 * resulting { url, public_id } refs as small JSON.
 *
 * Per-file size/type is still enforced (validateImageFile); there is no combined
 * cap because nothing large flows through our API anymore.
 */
import apiClient from './api';
import { validateImageFile } from './imageUpload';

export interface UploadedImage {
  url: string;
  public_id: string;
}

interface SignatureResponse {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
}

/**
 * Ask our backend to sign an upload into the given (allowlisted) folder key.
 * `subId` (e.g. a productId) groups assets into a per-entity subfolder; the
 * backend only honours a valid ObjectId, so it can't be an arbitrary path.
 */
async function getSignature(folder: string, subId?: string): Promise<SignatureResponse> {
  return apiClient.post<SignatureResponse>('/uploads/signature', { folder, subId });
}

/** Best-effort removal of assets that uploaded before a batch failed. */
async function cleanupUploaded(publicIds: string[]): Promise<void> {
  if (!publicIds.length) return;
  try {
    await apiClient.post('/uploads/cleanup', { publicIds });
  } catch {
    /* best-effort — a leftover asset is preferable to blocking the error path */
  }
}

/** Upload one file to Cloudinary using an already-fetched signature. */
async function uploadWithSignature(file: File, sig: SignatureResponse): Promise<UploadedImage> {
  const problem = validateImageFile(file);
  if (problem) throw new Error(problem);

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('folder', sig.folder);
  // Must match the signed value exactly, or Cloudinary rejects the signature.
  form.append('allowed_formats', sig.allowedFormats);
  form.append('signature', sig.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    let message = `Image upload failed (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) message = `Image upload failed: ${err.error.message}`;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }

  const data = await res.json();
  return { url: data.secure_url, public_id: data.public_id };
}

/**
 * Upload one image file directly to Cloudinary. Rejects (throws) on an invalid
 * file or a Cloudinary error, surfacing a user-facing message.
 */
export async function uploadImageToCloudinary(
  file: File,
  folder = 'products',
  subId?: string,
): Promise<UploadedImage> {
  return uploadWithSignature(file, await getSignature(folder, subId));
}

/**
 * Upload several files. One signature is minted for the whole batch (it's valid
 * for all of them within its window), then files upload sequentially: this stops
 * at the first failure and keeps memory/rate-limit pressure predictable. If a
 * file mid-batch fails, the assets that already uploaded are cleaned up so an
 * aborted product save doesn't strand orphans in Cloudinary.
 *
 * `subId` (e.g. a productId) groups the assets into a per-entity subfolder.
 */
export async function uploadImagesToCloudinary(
  files: File[],
  folder = 'products',
  subId?: string,
): Promise<UploadedImage[]> {
  if (!files.length) return [];
  const sig = await getSignature(folder, subId);
  const uploaded: UploadedImage[] = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadWithSignature(file, sig));
    }
  } catch (err) {
    await cleanupUploaded(uploaded.map((u) => u.public_id));
    throw err;
  }
  return uploaded;
}
