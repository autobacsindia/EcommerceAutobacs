/**
 * Careers applications — private (authenticated) direct-to-Cloudinary uploads.
 *
 * Kept in its OWN module (not utils/cloudinaryHelpers.js) so it doesn't couple
 * the careers flow to the shared image helper: several suites mock
 * cloudinaryHelpers with only its image exports, and a partial mock would break
 * the moment app.js transitively needs these. Isolating them keeps both stable.
 *
 * NEVER import on the frontend — API_SECRET must stay server-side only.
 */
import cloudinary from '../config/cloudinary.js';

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
 * caller check its size + format. Returns null when the asset is not found.
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
