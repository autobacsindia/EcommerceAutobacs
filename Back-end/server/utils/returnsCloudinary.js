/**
 * Return-request evidence — private (authenticated) direct-to-Cloudinary uploads.
 *
 * The customer records a continuous unboxing video + proof of purchase and
 * uploads them straight to Cloudinary from the browser with a short-lived signed
 * params set; the controller then RE-VALIDATES every asset server-side (exists,
 * lives under our folder, within the size cap, correct media type) before the
 * return is created — a client cannot attach a spoofed/oversized/foreign asset by
 * lying in the JSON payload.
 *
 * Kept in its OWN module (like utils/careersCloudinary.js) so mocking the shared
 * image helper in tests never breaks it. NEVER import on the frontend —
 * CLOUDINARY_API_SECRET must stay server-side only.
 */
import cloudinary from '../config/cloudinary.js';
import { providerOf, r2PrivateUrl } from '../services/storage/privateAssetUrl.js';

/**
 * Base folder every return-evidence upload is constrained to. The signature
 * endpoint appends a random per-request subfolder; submit-time validation
 * rejects any publicId that does not live under this prefix.
 */
export const RETURNS_FOLDER_BASE = 'autobacs/returns';

/**
 * Issue a short-lived signature for a browser DIRECT upload of return evidence.
 * Forces `type: authenticated` so assets are NOT publicly fetchable — only a
 * server-minted signed URL (signedReturnAssetUrl) can read them back. Only
 * Cloudinary-signable params are signed (see careersCloudinary for why
 * max_file_size must NOT be signed). The per-slot byte cap is enforced (a)
 * client-side and (b) authoritatively at submit against the Admin API.
 *
 * @param {object} opts
 * @param {string} opts.folder server-computed returns subfolder (base + nonce)
 * @returns {{ cloudName, apiKey, timestamp, folder, type, signature }}
 */
export const generateReturnUploadSignature = ({ folder }) => {
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
 * Look up a Cloudinary return asset for server-side validation. Returns null
 * when the asset is not found (so the controller can 400 "re-upload").
 *
 * @param {string} publicId
 * @param {'video'|'image'|'raw'} resourceType
 * @returns {Promise<{ public_id: string, bytes: number, format: string } | null>}
 */
export const getReturnResource = async (publicId, resourceType) => {
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

/** How long an admin's signed view link stays valid. */
const RETURNS_DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Mint a signed URL for a private return asset so an admin can view/download it.
 * RAW (PDF) uses the private-download API (raw delivery is blocked by default);
 * video/image deliver via a standard signed URL (allows inline playback).
 *
 * @param {string} publicId
 * @param {'video'|'image'|'raw'} resourceType
 * @returns {string}
 */
export const signedReturnAssetUrl = async (publicId, resourceType, ref) => {
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
    ttlSeconds: RETURNS_DOWNLOAD_TTL_SECONDS, });
  }

  const rt = resourceType || 'image';
  if (rt === 'raw') {
    return cloudinary.utils.private_download_url(publicId, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.round(Date.now() / 1000) + RETURNS_DOWNLOAD_TTL_SECONDS,
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
 * Effective format for a Cloudinary resource. Cloudinary populates `format` for
 * decoded media but leaves it undefined for `raw` — fall back to the public_id
 * extension so raw (PDF) proof validates. (For raw this is an extension check,
 * one layer alongside folder scope + size cap + private storage — not a sniff.)
 */
export const resourceFormat = (resource, publicId) => {
  if (resource.format) return String(resource.format).toLowerCase();
  const m = String(publicId).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};
