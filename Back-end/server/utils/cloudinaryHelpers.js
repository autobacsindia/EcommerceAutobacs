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

/** Lightweight HTTP error — carries a statusCode for the Express error handler */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

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
// generateUploadSignature
// ────────────────────────────────────────────────────────────────────────────
/**
 * Issue a short-lived signature for a browser-side *direct* Cloudinary upload.
 *
 * The browser uploads the image bytes straight to Cloudinary using these signed
 * params — bypassing our API and any proxy request-body limit (~4.5 MB) — then
 * sends only the resulting { url, public_id } back to us. The API secret never
 * leaves the server: it is used solely to compute the signature here.
 *
 * `folder` + `timestamp` + `allowed_formats` are signed, so those are the only
 * params (besides file/api_key) the client may send to Cloudinary; anything else
 * breaks the signature. `allowed_formats` makes Cloudinary itself reject any
 * non-image upload server-side — a defence the direct path would otherwise lose
 * versus the multer/magic-byte checks on the server-side upload path.
 *
 * @param {object} opts
 * @param {string} [opts.folder='general'] Cloudinary folder (constrained by the caller)
 * @returns {{ cloudName, apiKey, timestamp, folder, allowedFormats, signature }}
 */
export const generateUploadSignature = ({ folder = 'general' } = {}) => {
  const timestamp = Math.round(Date.now() / 1000);
  const allowedFormats = ALLOWED_FORMATS.join(',');
  const signature = cloudinary.utils.api_sign_request(
    { allowed_formats: allowedFormats, folder, timestamp },
    process.env.CLOUDINARY_API_SECRET,
  );
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:    process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    allowedFormats,
    signature,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// uploadRawToCloudinary
// ────────────────────────────────────────────────────────────────────────────
/**
 * Upload a single NON-image buffer (PDF, etc.) to Cloudinary as a raw resource.
 * Unlike uploadToCloudinary this applies no image transformation / format
 * allowlist. Used for artefacts like courier shipping slips and invoices.
 *
 * @param {Buffer} buffer
 * @param {object} options
 * @param {string} options.folder      Cloudinary folder path
 * @param {string} [options.publicId]  Explicit public_id (include the extension,
 *                                      e.g. `slip-123.pdf`, so the delivery URL
 *                                      keeps a .pdf suffix). Overwrites on match.
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
export const uploadRawToCloudinary = (buffer, options = {}) => {
  const { folder = 'general', publicId } = options;

  return new Promise((resolve, reject) => {
    const uploadOptions = { folder, resource_type: 'raw' };
    if (publicId) {
      uploadOptions.public_id = publicId;
      uploadOptions.overwrite = true;
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error(`[Cloudinary] Raw upload failed — folder: ${folder} | error: ${error.message}`);
          return reject(new AppError(`Cloudinary upload failed: ${error.message}`, 500));
        }
        console.log(
          `[Cloudinary] Uploaded (raw): ${result.public_id} | ${result.bytes} bytes | ${result.secure_url}`
        );
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
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


// ────────────────────────────────────────────────────────────────────────────
// Careers applications — private (authenticated) direct uploads
// ────────────────────────────────────────────────────────────────────────────
/**
 * Base folder every careers upload is constrained to. The signature endpoint
 * appends a random per-applicant subfolder; submit-time validation rejects any
 * publicId that does not live under this prefix.
 */
export const CAREERS_FOLDER_BASE = 'autobacs/careers';

/**
 * Absolute per-file ceiling Cloudinary itself enforces on careers uploads (the
 * largest slot — 30MB video). Signed into the params so a client cannot raise
 * it; Cloudinary rejects anything bigger at upload time, which caps abuse even
 * when the attacker never calls our submit endpoint (where the finer per-slot
 * byte + format checks run). Kept in sync with VIDEO_MAX_BYTES in the controller.
 */
export const CAREERS_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * Issue a short-lived signature for a browser-side DIRECT upload of a careers
 * asset (video answer / resume PDF). Unlike the admin image signature this does
 * NOT restrict allowed_formats (videos + PDFs are expected) and forces
 * `type: authenticated` so the resulting asset is NOT publicly fetchable — only
 * a signed URL minted server-side (signedCareersAssetUrl) can read it back.
 * `max_file_size` is signed so Cloudinary hard-rejects oversized uploads server
 * side regardless of what the client claims.
 *
 * The same signature signs every file in one submission (folder + timestamp +
 * type + max_file_size match), so the browser fetches it once. `folder` is
 * server-chosen (base + nonce) — never client-supplied.
 *
 * @param {object} opts
 * @param {string} opts.folder  server-computed careers subfolder
 * @returns {{ cloudName, apiKey, timestamp, folder, type, maxFileSize, signature }}
 */
export const generateCareersUploadSignature = ({ folder }) => {
  const timestamp = Math.round(Date.now() / 1000);
  const type = 'authenticated';
  const maxFileSize = CAREERS_MAX_UPLOAD_BYTES;
  const signature = cloudinary.utils.api_sign_request(
    { folder, max_file_size: maxFileSize, timestamp, type },
    process.env.CLOUDINARY_API_SECRET,
  );
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:    process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    type,
    maxFileSize,
    signature,
  };
};

/**
 * Look up a Cloudinary resource (careers asset) for server-side validation:
 * confirms the publicId actually exists, lives under our folder, and lets the
 * caller check its size. Returns null when the asset is not found.
 *
 * @param {string} publicId
 * @param {'video'|'raw'|'image'} resourceType
 * @returns {Promise<{ public_id: string, bytes: number, format: string } | null>}
 */
export const getCareersResource = async (publicId, resourceType) => {
  try {
    return await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
    });
  } catch (err) {
    if (err?.http_code === 404 || err?.error?.http_code === 404) return null;
    throw err;
  }
};

/**
 * Mint a signed delivery URL for a private (authenticated) careers asset so an
 * admin can view/download it. The signature is required to fetch the asset — a
 * leaked plain URL is useless — and generation itself is behind admin auth.
 *
 * @param {string} publicId
 * @param {'video'|'raw'|'image'} resourceType
 * @returns {string}
 */
export const signedCareersAssetUrl = (publicId, resourceType) => {
  if (!publicId) return '';
  return cloudinary.url(publicId, {
    resource_type: resourceType || 'raw',
    type: 'authenticated',
    sign_url: true,
    secure: true,
  });
};
