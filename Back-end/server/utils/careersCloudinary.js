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
import { providerOf, r2PrivateUrl } from '../services/storage/privateAssetUrl.js';

/**
 * Base folder every careers upload is constrained to. The signature endpoint
 * appends a random per-applicant subfolder; submit-time validation rejects any
 * publicId that does not live under this prefix.
 */
export const CAREERS_FOLDER_BASE = 'autobacs/careers';

/**
 * Issue a short-lived signature for a browser-side DIRECT upload of a careers
 * asset (video answer / resume PDF). Unlike the admin image signature this does
 * NOT restrict allowed_formats (videos + PDFs are expected) and forces
 * `type: authenticated` so the resulting asset is NOT publicly fetchable — only
 * a signed URL minted server-side (signedCareersAssetUrl) can read it back.
 *
 * IMPORTANT: sign ONLY parameters Cloudinary recognises as signable. `max_file_size`
 * is NOT a Cloudinary upload parameter — it never appears in Cloudinary's
 * string-to-sign, so including it here produces a signature Cloudinary can never
 * reproduce → every upload 401s ("Invalid Signature"). The real per-slot byte cap
 * is enforced (a) client-side before upload and (b) authoritatively at submit,
 * where the controller re-reads each asset's `bytes` from the Cloudinary Admin API
 * and rejects anything over the slot limit. Abuse of the signature endpoint itself
 * is bounded by its rate limiter. (For a hard Cloudinary-side size cap, the correct
 * mechanism is a signed `upload_preset` configured with a max file size — not
 * shipped; add it as a unit if abuse volume warrants it.)
 *
 * The same signature signs every file in one submission (folder + timestamp +
 * type match), so the browser fetches it once. `folder` is server-chosen
 * (base + nonce) — never client-supplied.
 *
 * @param {object} opts
 * @param {string} opts.folder  server-computed careers subfolder
 * @returns {{ cloudName, apiKey, timestamp, folder, type, signature }}
 */
export const generateCareersUploadSignature = ({ folder }) => {
  const timestamp = Math.round(Date.now() / 1000);
  const type = 'authenticated';
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp, type },
    process.env.CLOUDINARY_API_SECRET,
  );
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:    process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    type,
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
 * How long an admin's signed view/download link stays valid (raw assets). Long
 * enough to open from the inbox, short enough that a copied link soon dies.
 */
const CAREERS_DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Mint a signed URL for a private (authenticated) careers asset so an admin can
 * view/download it. The signature is required to fetch the asset — a leaked
 * plain URL is useless — and generation itself is behind admin auth.
 *
 * RAW (PDF) vs VIDEO need different mechanisms:
 *   - RAW: a normal signed DELIVERY URL 401s, because Cloudinary blocks raw/PDF
 *     delivery by default (account "restricted media types"). The private-download
 *     API is the supported path — a short-lived signed link that serves the
 *     private asset regardless of that setting. The public_id already carries the
 *     extension, so `format` is passed empty.
 *   - VIDEO/IMAGE: decoded media delivers fine via a standard signed URL, which
 *     also allows inline playback (better than forcing a download).
 *
 * @param {string} publicId
 * @param {'video'|'raw'|'image'} resourceType
 * @returns {string}
 */
export const signedCareersAssetUrl = async (publicId, resourceType, ref) => {
  if (!publicId) return '';

  /*
    During the Cloudinary -> R2 migration both stores hold live assets, so
    the read path resolves either. `ref` is the stored file reference; when
    it is absent or carries no provider the asset predates the migration and
    is Cloudinary — see providerOf(). Routing on an explicit field rather
    than the shape of the id, which is identical between the two.
  */
  if (providerOf(ref) === 'r2') {
    return r2PrivateUrl({ key: publicId,
    ttlSeconds: CAREERS_DOWNLOAD_TTL_SECONDS, });
  }

  const rt = resourceType || 'raw';
  if (rt === 'raw') {
    return cloudinary.utils.private_download_url(publicId, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.round(Date.now() / 1000) + CAREERS_DOWNLOAD_TTL_SECONDS,
    });
  }
  return cloudinary.url(publicId, {
    resource_type: rt,
    type: 'authenticated',
    sign_url: true,
    secure: true,
  });
};

/**
 * Delete a careers asset. Used by the orphan-cleanup endpoint when a submission
 * fails after its files have already uploaded.
 *
 * `not_found` counts as success: the caller's goal is "this object is not
 * there", and a retry of a cleanup that already partly ran must be able to
 * finish rather than reporting failure for work that is already done.
 *
 * Never throws — cleanup runs on a path where the applicant is already looking
 * at an error, and a failure to tidy up must not replace or worsen that message.
 *
 * @param {string} publicId
 * @param {'video'|'raw'|'image'} resourceType
 * @returns {Promise<boolean>} true when the asset is gone
 */
export const deleteCareersAsset = async (publicId, resourceType = 'raw') => {
  if (!publicId || !publicId.startsWith(`${CAREERS_FOLDER_BASE}/`)) return false;
  const rt = ['video', 'raw', 'image'].includes(resourceType) ? resourceType : 'raw';
  try {
    const res = await cloudinary.api.delete_resources([publicId], {
      resource_type: rt,
      type: 'authenticated',
    });
    const status = res?.deleted?.[publicId];
    return status === 'deleted' || status === 'not_found';
  } catch (err) {
    console.error(`[Careers][CLEANUP_REQUIRED] delete failed ${publicId}: ${err.message}`);
    return false;
  }
};
