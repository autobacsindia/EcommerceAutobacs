/**
 * Mint upload targets for a direct browser → storage upload.
 *
 * Cloudinary and R2 differ in a way that leaks into the API: a Cloudinary
 * signature is minted for a FOLDER and is reusable for every file in the batch,
 * whereas an R2 presigned PUT is bound to ONE object key. So the R2 path has to
 * know how many files are coming and what type each is, and it returns one
 * target per file rather than a single reusable credential.
 *
 * ── What the server decides, and why ────────────────────────────────────────
 * The object key is built here, never accepted from the client: folder from an
 * allowlist, an optional per-entity subfolder that must be a Mongo ObjectId, a
 * random basename, and an extension derived from the ALLOWLISTED content type —
 * never from the uploaded filename, which is attacker-controlled and is how you
 * end up with `.html` or `.svg` served off your own domain.
 *
 * ⚠ KNOWN GAP vs the Cloudinary path. Cloudinary's `allowed_formats` made the
 *   PROVIDER reject a non-image server-side; it decoded the bytes. R2 does not:
 *   it stores whatever it is given, AND — verified against the live bucket — it
 *   does not even enforce the Content-Type the URL was signed with. A URL signed
 *   for `image/png` accepted `text/html` and R2 served it back as `text/html`.
 *   Treat the signed Content-Type as a hint to the client, never as a control.
 *
 *   The containment for that lives at the DELIVERY boundary, not here: the image
 *   Worker clamps every served Content-Type to an image allowlist and sends
 *   `X-Content-Type-Options: nosniff`, so HTML in the bucket cannot execute on
 *   the image host (a subdomain of the apex, hence a cookie-theft risk).
 *   This endpoint is admin-only (`protect` + `admin`), so the exposure is an
 *   authenticated admin storing junk rather than an anonymous upload vector.
 *   Real content verification arrives with the variant-generation job, which
 *   decodes every uploaded image with sharp and fails loudly on anything that
 *   is not one. Do not treat the signed Content-Type as validation.
 */
import crypto from 'crypto';
import { presignPut } from './r2Provider.js';
import AppError from '../../utils/AppError.js';
import { r2Config } from '../../config/storage.js';
import { toObjectUrl } from './keys.js';

/** Content types we accept, and the extension each maps to. */
export const UPLOAD_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Max files in one batch — matches the Cloudinary path's multer limit. */
export const MAX_BATCH = 8;

/**
 * Build one object key.
 * Mirrors the Cloudinary public_id shape (`<folder>/<random>`) so the two stores
 * stay visually comparable while both hold live assets.
 */
export const buildKey = (folder, contentType) => {
  const ext = UPLOAD_TYPES[String(contentType || '').toLowerCase()];
  if (!ext || !folder) return '';
  return `${folder}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
};

/**
 * Presigned PUT targets for a batch.
 *
 * @param {object} opts
 * @param {string} opts.folder            server-resolved, already allowlisted
 * @param {Array<{contentType:string}>} opts.files
 * @returns {Promise<Array<{uploadUrl,key,url,contentType,expiresIn}>>}
 * @throws  AppError(400, expose) when any content type is not allowlisted — the
 *          batch is rejected whole rather than silently dropping a file, so the
 *          client cannot end up with a product referencing an image that was
 *          never uploaded. It must be an AppError: errorMiddleware only exposes
 *          messages raised that way, so a plain Error would reach the admin as
 *          "Something went wrong" and hide which file it objected to.
 */
export const buildR2UploadTargets = async ({ folder, files = [] }) => {
  const list = Array.isArray(files) ? files.slice(0, MAX_BATCH) : [];
  if (!list.length) return [];

  const bad = list.find((f) => !UPLOAD_TYPES[String(f?.contentType || '').toLowerCase()]);
  if (bad) {
    // The offending type is echoed because an admin needs to know WHICH file was
    // refused, but clipped and stripped of anything outside a media-type charset
    // so a hostile string cannot ride back out in an error body.
    const shown = String(bad.contentType || '').replace(/[^a-zA-Z0-9/.+-]/g, '').slice(0, 40) || 'unknown';
    throw new AppError(`Unsupported file type "${shown}". Allowed: JPG, PNG, WebP.`, 400, { expose: true });
  }

  /*
    Without a public base URL the target's `url` would be '' — which the browser
    dutifully stores on the product, where it fails the image host check and the
    admin is told the save succeeded with no image to show for it. Fail here,
    where the message can name the cause, rather than three layers downstream.
  */
  const publicBase = r2Config().publicBaseUrl;
  if (!publicBase) {
    throw new AppError(
      'Image uploads are misconfigured: R2_PUBLIC_BASE_URL is not set on the server.',
      500,
    );
  }

  return Promise.all(list.map(async (f) => {
    const contentType = String(f.contentType).toLowerCase();
    const key = buildKey(folder, contentType);
    const { url: uploadUrl, expiresIn } = await presignPut({
      key, scope: 'public', contentType,
    });
    return {
      uploadUrl,
      key,
      // Where the object will be readable once the PUT completes. Stored as the
      // asset's `url`; the image loader rewrites it to a variant at render time.
      url: toObjectUrl(publicBase, key),
      contentType,
      expiresIn,
    };
  }));
};

export default { UPLOAD_TYPES, MAX_BATCH, buildKey, buildR2UploadTargets };
