/**
 * Cloudinary public_id  ⇄  R2 object key.
 *
 * This module is the linchpin of the Cloudinary → R2 migration, so it is pure,
 * total, and has no I/O: the copy script, the URL rewriter and the delete path
 * must all derive the SAME key for the same asset, or the migration silently
 * orphans objects (bytes in R2 nobody can address) and leaks storage forever.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The R2 key is the Cloudinary public_id VERBATIM, with the format appended as
 * a file extension when the public_id does not already carry it.
 *
 *   image  autobacs/products/abc123        + jpg → autobacs/products/abc123.jpg
 *   video  autobacs/careers/n0nce/answer1  + mp4 → autobacs/careers/n0nce/answer1.mp4
 *   raw    shipping-slips/slip-AB12.pdf    + pdf → shipping-slips/slip-AB12.pdf  (unchanged)
 *
 * Cloudinary stores `format` as metadata separate from the public_id for image
 * and video resources, but BAKES the extension into the public_id for `raw`
 * ones (that is how uploadRawToCloudinary is called — see cloudinaryHelpers).
 * Appending unconditionally would produce `slip-AB12.pdf.pdf`, so the
 * already-suffixed case is detected rather than assumed.
 *
 * ── Why verbatim, and not normalised ────────────────────────────────────────
 * Verbatim keeps the mapping REVERSIBLE: given an R2 key we can recover the
 * public_id and re-verify against Cloudinary during the migration soak. A
 * normalising map (lowercasing, slugifying, stripping spaces) is one-way and
 * would make "did this object copy correctly?" unanswerable for any asset whose
 * name normalised into a collision.
 *
 * That matters here because one real prod folder contains a SPACE:
 * `autobacs/vehicle and makes`. Spaces are legal in S3/R2 keys, so we keep them
 * in the key and encode them when building a URL (see toObjectUrl). Encoding is
 * a URL concern, not a storage concern; conflating the two is what produces the
 * classic "works until someone uploads a file with a space" bug.
 */

/** Extension present on a public_id, lowercased, or '' when there is none. */
const trailingExtension = (publicId) => {
  const lastSlash = publicId.lastIndexOf('/');
  const basename = lastSlash === -1 ? publicId : publicId.slice(lastSlash + 1);
  const dot = basename.lastIndexOf('.');
  // A leading dot is a dotfile, not an extension (".gitkeep" has no extension).
  if (dot <= 0) return '';
  return basename.slice(dot + 1).toLowerCase();
};

/**
 * Derive the R2 object key for a Cloudinary asset.
 *
 * @param {object}  asset
 * @param {string}  asset.publicId  Cloudinary public_id (required)
 * @param {string} [asset.format]   Cloudinary `format` field (e.g. 'jpg', 'mp4')
 * @returns {string} the object key, or '' when no key can be derived
 */
export const r2KeyFor = ({ publicId, format } = {}) => {
  if (typeof publicId !== 'string') return '';

  // Leading/trailing slashes would create an empty path segment in R2, which is
  // addressable but not by any URL we build. Reject rather than silently mangle.
  const id = publicId.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!id) return '';

  const ext = typeof format === 'string' ? format.trim().toLowerCase() : '';
  if (!ext) return id;                          // no format metadata — best we can do
  if (trailingExtension(id) === ext) return id; // already suffixed (raw resources)
  return `${id}.${ext}`;
};

/**
 * Recover the Cloudinary public_id from an R2 key. The inverse of r2KeyFor for
 * image/video assets; for `raw` assets the extension IS part of the public_id,
 * so the caller passes the resource type to keep it.
 *
 * @param {string} key
 * @param {'image'|'video'|'raw'} [resourceType='image']
 * @returns {string}
 */
export const publicIdFromR2Key = (key, resourceType = 'image') => {
  if (typeof key !== 'string' || !key) return '';
  if (resourceType === 'raw') return key;
  const ext = trailingExtension(key);
  return ext ? key.slice(0, -(ext.length + 1)) : key;
};

/**
 * Build a public delivery URL for an object key.
 *
 * Each path SEGMENT is encoded independently so slashes stay structural while
 * spaces and other unsafe characters (see `autobacs/vehicle and makes`) become
 * percent-escapes. encodeURIComponent on the whole key would eat the slashes;
 * encodeURI would leave some characters that break in a srcset, where a comma
 * or space is a delimiter.
 *
 * @param {string} baseUrl  e.g. https://img.autobacsindia.com (no trailing slash required)
 * @param {string} key
 * @returns {string} '' when either argument is unusable
 */
export const toObjectUrl = (baseUrl, key) => {
  if (typeof baseUrl !== 'string' || !baseUrl || typeof key !== 'string' || !key) return '';
  const base = baseUrl.replace(/\/+$/, '');
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/${path}`;
};

export default { r2KeyFor, publicIdFromR2Key, toObjectUrl };
