/**
 * Cloudinary Helper Utilities
 *
 * uploadToCloudinary(buffer, options)          — single upload
 * deleteFromCloudinary(publicId)               — delete with failure logging
 * uploadManyToCloudinary(buffers, options)     — parallel upload, ALL-OR-NOTHING rollback
 * deleteManyFromCloudinary(publicIds)          — parallel delete
 * buildOptimizedUrl(publicId, transforms)      — optimized URL builder
 */
import cloudinary from '../config/cloudinary.js';
import { AppError } from '../middleware/errorMiddleware.js';

/** Formats accepted at Cloudinary level (second defence after multer) */
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];

// ────────────────────────────────────────────────────────────────────────────
// uploadToCloudinary
// ────────────────────────────────────────────────────────────────────────────
/**
 * Upload a single image buffer to Cloudinary.
 *
 * @param {Buffer} buffer
 * @param {object} options
 * @param {string} options.folder       Cloudinary folder path
 * @param {string} [options.publicId]   Optional explicit public_id
 * @param {string} [options.resourceType='image']
 * @returns {{ secure_url: string, public_id: string }}
 */
export const uploadToCloudinary = (buffer, options = {}) => {
  const { folder = 'general', publicId, resourceType = 'image' } = options;

  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type:   resourceType,
      allowed_formats: ALLOWED_FORMATS,
      transformation: [
        { fetch_format: 'auto', quality: 'auto' },
      ],
    };

    if (publicId) {
      uploadOptions.public_id = publicId;
      uploadOptions.overwrite = true;
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error(`[Cloudinary] Upload failed — folder: ${folder} | error: ${error.message}`);
          return reject(new AppError(`Cloudinary upload failed: ${error.message}`, 500));
        }
        console.log(
          `[Cloudinary] Uploaded: ${result.public_id} | ${result.format} | ${result.bytes} bytes | ${result.secure_url}`
        );
        resolve({
          secure_url: result.secure_url,
          public_id:  result.public_id,
        });
      }
    );

    uploadStream.end(buffer);
  });
};

// ────────────────────────────────────────────────────────────────────────────
// deleteFromCloudinary
// ────────────────────────────────────────────────────────────────────────────
/**
 * Delete a single asset from Cloudinary.
 * Safe to call with null/undefined publicId — returns early.
 * Logs failure with public_id so a cleanup cron can pick it up.
 *
 * @param {string} publicId
 * @param {string} [resourceType='image']
 */
export const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  if (!publicId) return;

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    if (result.result === 'ok') {
      console.log(`[Cloudinary] Deleted: ${publicId}`);
    } else {
      // 'not found' means already deleted — not an error
      console.warn(`[Cloudinary] Delete result for ${publicId}: ${result.result}`);
    }
  } catch (error) {
    // ⚠️ Log with structured tag so a log-scraper / cron can find orphaned assets
    console.error(
      `[Cloudinary][CLEANUP_REQUIRED] Failed to delete asset — public_id: ${publicId} | error: ${error.message}`
    );
    // Do NOT throw — deletion failure must never block the main business operation
  }
};

// ────────────────────────────────────────────────────────────────────────────
// uploadManyToCloudinary — ALL-OR-NOTHING
// ────────────────────────────────────────────────────────────────────────────
/**
 * Upload multiple image buffers in parallel.
 *
 * ALL-OR-NOTHING behaviour:
 *   - If ALL uploads succeed → return results array
 *   - If ANY upload fails    → delete already-uploaded assets and throw
 *
 * This prevents orphaned Cloudinary images when a batch partially fails.
 *
 * @param {Buffer[]} buffers
 * @param {object}   options  — same as uploadToCloudinary
 * @returns {{ secure_url: string, public_id: string }[]}
 */
export const uploadManyToCloudinary = async (buffers, options = {}) => {
  if (!buffers.length) return [];

  console.log(`[Cloudinary] Starting batch upload: ${buffers.length} file(s) → folder: ${options.folder || 'general'}`);

  const results = await Promise.allSettled(
    buffers.map((buf, idx) => uploadToCloudinary(buf, { ...options, _idx: idx }))
  );

  const succeeded = [];
  const failed    = [];

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      succeeded.push(result.value);
    } else {
      failed.push({ idx, reason: result.reason?.message });
    }
  });

  if (failed.length > 0) {
    // Log every failure
    failed.forEach(({ idx, reason }) => {
      console.error(`[Cloudinary] Batch upload — image[${idx}] failed: ${reason}`);
    });

    // Rollback: delete all assets that DID upload to prevent orphans
    if (succeeded.length > 0) {
      console.warn(`[Cloudinary] Rolling back ${succeeded.length} successful upload(s) due to partial failure...`);
      await deleteManyFromCloudinary(succeeded.map((s) => s.public_id));
    }

    throw new AppError(
      `Image upload failed: ${failed.length} of ${buffers.length} file(s) could not be uploaded. No changes were saved.`,
      500
    );
  }

  console.log(`[Cloudinary] Batch upload complete: ${succeeded.length} file(s) uploaded.`);
  return succeeded;
};

// ────────────────────────────────────────────────────────────────────────────
// deleteManyFromCloudinary
// ────────────────────────────────────────────────────────────────────────────
/**
 * Delete multiple Cloudinary assets in parallel.
 * Individual failures are logged but do not stop others from being deleted.
 *
 * @param {string[]} publicIds
 * @param {string}   [resourceType='image']
 */
export const deleteManyFromCloudinary = async (publicIds = [], resourceType = 'image') => {
  const ids = publicIds.filter(Boolean);
  if (!ids.length) return;

  console.log(`[Cloudinary] Deleting ${ids.length} asset(s)...`);
  await Promise.allSettled(ids.map((id) => deleteFromCloudinary(id, resourceType)));
};

// ────────────────────────────────────────────────────────────────────────────
// buildOptimizedUrl
// ────────────────────────────────────────────────────────────────────────────
/**
 * Build an optimized Cloudinary delivery URL.
 * Applies f_auto + q_auto by default. Pass width/height/crop for resizing.
 *
 * @param {string} publicId
 * @param {object} [transforms]
 * @param {number} [transforms.width]
 * @param {number} [transforms.height]
 * @param {string} [transforms.crop]   e.g. 'fill', 'thumb', 'scale'
 * @returns {string}
 *
 * @example
 * // Product thumbnail 500px wide
 * buildOptimizedUrl('autobacs/products/abc123', { width: 500, crop: 'fill' })
 * // → https://res.cloudinary.com/dhwxtl6l8/image/upload/f_auto,q_auto,w_500,c_fill/autobacs/products/abc123
 *
 * // Use on the frontend:
 * <Image src={buildOptimizedUrl(product.images[0].public_id, { width: 800 })} ... />
 */
export const buildOptimizedUrl = (publicId, transforms = {}) => {
  if (!publicId) return '';
  return cloudinary.url(publicId, {
    fetch_format: 'auto',
    quality:      'auto',
    secure:       true,
    ...transforms,
  });
};

