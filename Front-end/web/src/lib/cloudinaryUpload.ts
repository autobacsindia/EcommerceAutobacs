/**
 * Direct browser → object storage image upload (signed).
 *
 * NOTE ON THE FILENAME: this module now targets Cloudinary OR Cloudflare R2,
 * so `cloudinaryUpload` is a misnomer. The rename is deliberately deferred to
 * the Cloudinary decommission (Phase 7) to keep the migration diffs about
 * behaviour rather than churn across five admin pages.
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
  /**
   * Intrinsic pixel dimensions, as reported by Cloudinary.
   *
   * Optional because most callers only persist the URL. Anything that must
   * reserve layout space before the image loads (the promo banner scales to its
   * own aspect ratio) needs these — measuring client-side would mean measuring
   * after the shift has already happened.
   */
  width?: number;
  height?: number;
}

/** Cloudinary: one reusable signature for the whole folder. */
interface CloudinarySignature {
  provider?: 'cloudinary';
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  allowedFormats: string;
  signature: string;
}

/** R2: a presigned PUT is bound to ONE key, so we get one target per file. */
interface R2UploadTarget {
  uploadUrl: string;
  key: string;
  url: string;
  contentType: string;
  expiresIn: number;
}
interface R2Signature {
  provider: 'r2';
  folder: string;
  uploads: R2UploadTarget[];
}

/*
  A discriminated union rather than two overlapping shapes: during the migration
  either provider can answer, and branching on an explicit `provider` beats
  sniffing which fields happen to be present.
*/
type SignatureResponse = CloudinarySignature | R2Signature;

/**
 * Ask our backend to sign an upload into the given (allowlisted) folder key.
 * `subId` (e.g. a productId) groups assets into a per-entity subfolder; the
 * backend only honours a valid ObjectId, so it can't be an arbitrary path.
 */
async function getSignature(
  folder: string,
  subId?: string,
  files?: { contentType: string }[],
): Promise<SignatureResponse> {
  // `files` is what R2 needs to mint one presigned PUT per object. Cloudinary
  // ignores it, so the same call serves both providers.
  return apiClient.post<SignatureResponse>('/uploads/signature', { folder, subId, files });
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

/**
 * PUT one file straight at R2 using a presigned target.
 *
 * The target carries the Content-Type rather than us re-reading `file.type`, so
 * the header matches what the server signed.
 *
 * ⚠ Do NOT read that as validation: R2 does not enforce the signed Content-Type
 * (verified against the live bucket), so this header is a convention, not a
 * control. Non-image content is contained at delivery — the image Worker clamps
 * the served type to an image allowlist and sends `nosniff`.
 *
 * R2 returns no body, so the resulting url/public_id come from the server-minted
 * target — nothing about the stored object is client-derived.
 */
async function putToR2(file: File, target: R2UploadTarget): Promise<UploadedImage> {
  const problem = validateImageFile(file);
  if (problem) throw new Error(problem);

  const res = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': target.contentType },
    body: file,
  });

  if (!res.ok) {
    throw new Error(`Image upload failed (HTTP ${res.status})`);
  }

  return { url: target.url, public_id: target.key };
}

/** Upload one file to Cloudinary using an already-fetched signature. */
async function uploadWithSignature(file: File, sig: CloudinarySignature): Promise<UploadedImage> {
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
  return {
    url: data.secure_url,
    public_id: data.public_id,
    width: data.width,
    height: data.height,
  };
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
  return (await uploadImagesToCloudinary([file], folder, subId))[0];
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

  /*
    Validate BEFORE asking for credentials. An unsupported type would be
    rejected by the signature endpoint anyway (R2 refuses the whole batch rather
    than silently dropping a file), but failing here keeps the error next to the
    file that caused it instead of surfacing as an opaque 400.
  */
  for (const file of files) {
    const problem = validateImageFile(file);
    if (problem) throw new Error(problem);
  }

  const sig = await getSignature(
    folder,
    subId,
    files.map((f) => ({ contentType: f.type })),
  );

  const uploaded: UploadedImage[] = [];
  try {
    if (sig.provider === 'r2') {
      if (sig.uploads.length !== files.length) {
        // Never pair a file with someone else's presigned key.
        throw new Error('Upload could not be prepared. Please try again.');
      }
      // Sequential, as the Cloudinary path was: it stops at the first failure
      // and keeps memory and rate-limit pressure predictable on a big gallery.
      for (let i = 0; i < files.length; i += 1) {
        uploaded.push(await putToR2(files[i], sig.uploads[i]));
      }
    } else {
      for (const file of files) {
        uploaded.push(await uploadWithSignature(file, sig));
      }
    }
  } catch (err) {
    // Whatever landed before the failure is handed back for deletion, so an
    // aborted product save cannot strand orphans in either store.
    await cleanupUploaded(uploaded.map((u) => u.public_id));
    throw err;
  }
  return uploaded;
}
