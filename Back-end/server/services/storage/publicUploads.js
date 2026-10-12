/**
 * Server-side upload of ONE public image buffer, routed by `STORAGE_PROVIDER`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Most public imagery reaches storage through `routes/uploads.js`, which issues
 * a signature and lets the admin browser upload directly. That path has read
 * `STORAGE_PROVIDER` since the cutover.
 *
 * Four screens do not use it. Brand logos, vehicle photos, category images and
 * customer avatars POST the file to us and we upload the buffer ourselves —
 * and those four called `uploadToCloudinary` unconditionally, so they kept
 * writing to Cloudinary for six weeks after the provider flip. That is exactly
 * how the five stragglers were created: the brand logo and the four vehicle
 * photos that were still served from Cloudinary in October, long after the
 * catalog had moved.
 *
 * So the rule the direct-upload path follows is now available to the ones that
 * cannot use it: read the provider per call, and return the SAME shape either
 * way — `{ secure_url, public_id }`, which is what every call site already
 * destructures. Switching a screen over is a one-line change, and flipping
 * `STORAGE_PROVIDER` back remains the rollback for all of them at once.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * Everything that can fail cheaply is checked BEFORE the object is written. A
 * missing delivery host or an unsupported content type discovered afterwards
 * would leave bytes in the bucket that no document references and no cleanup
 * sweep can find — the orphan shape that produced 1.68 GB of unattributable
 * uploads on the careers path.
 */
import { storageProvider } from '../../config/storage.js';
import { uploadToCloudinary } from '../../utils/cloudinaryHelpers.js';
import { enqueueVariantGeneration } from '../../queue/queues.js';
import { putObject } from './r2Provider.js';
import { buildKey, UPLOAD_TYPES } from './uploadTargets.js';
import AppError from '../../utils/AppError.js';

/**
 * Long-lived immutable caching, matching what the migration wrote for every
 * other public object. The key carries a random component and is never reused,
 * so the object at a given URL cannot change.
 */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Upload one image buffer to the active public store.
 *
 * @param {Buffer} buffer
 * @param {object} opts
 * @param {string} opts.folder        server-chosen folder, never client input
 * @param {string} [opts.contentType] the multer mimetype; required on R2
 * @returns {Promise<{ secure_url: string, public_id: string, provider: 'cloudinary'|'r2' }>}
 * @throws  {AppError} 400 when the content type is not an allowed image type,
 *          500 when R2 is selected but has no delivery host configured.
 */
export const putPublicAsset = async (buffer, { folder, contentType } = {}) => {
  if (storageProvider() !== 'r2') {
    const uploaded = await uploadToCloudinary(buffer, { folder });
    return { ...uploaded, provider: 'cloudinary' };
  }

  /*
    Validate before writing. `buildKey` returns '' for a type outside the
    allowlist — the same allowlist multer enforces, so in practice this only
    fires if the two ever drift apart, which is precisely when a loud failure
    is wanted.
  */
  const key = buildKey(folder, contentType);
  if (!key) {
    const allowed = Object.keys(UPLOAD_TYPES).join(', ');
    throw new AppError(
      `Unsupported image type "${contentType || 'unknown'}". Allowed: ${allowed}.`,
      400,
    );
  }
  if (!process.env.R2_PUBLIC_BASE_URL) {
    throw new AppError('[Storage] R2_PUBLIC_BASE_URL is not set — the image would have no address.', 500);
  }

  const { url } = await putObject({
    body: buffer,
    key,
    scope: 'public',
    contentType,
    cacheControl: PUBLIC_CACHE_CONTROL,
  });

  /*
    Ask for the AVIF/WebP derivatives, exactly as routes/uploads.js does for a
    direct upload. Best-effort by contract: the image Worker serves the
    original when a variant is missing, so a queue outage must slow images
    down, never fail the admin's save.
  */
  enqueueVariantGeneration(key);

  return { secure_url: url, public_id: key, provider: 'r2' };
};

export default { putPublicAsset, PUBLIC_CACHE_CONTROL };
