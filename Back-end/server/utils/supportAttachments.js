/**
 * Support-ticket attachments — private (authenticated) Cloudinary storage.
 *
 * Unlike careers uploads (browser direct-to-Cloudinary with a signed request),
 * these arrive already base64-encoded inside the Postmark inbound webhook
 * payload, so the upload happens server-side.
 *
 * Kept in its own module for the same reason as utils/careersCloudinary.js:
 * several test suites mock the shared cloudinary helper with only its image
 * exports, and a partial mock would break the moment app.js transitively needed
 * these.
 *
 * SECURITY
 * --------
 * Every byte here came from an unauthenticated stranger who emailed support@.
 *  - The sender's Content-Type is attacker-controlled, so the extension is
 *    checked too; a mismatch on either is a rejection.
 *  - The public_id is server-generated. The sender's filename is stored for
 *    display only and never used to build a path, or an executable could be
 *    written outside the intended folder or overwrite an existing asset.
 *  - Assets are `type: 'authenticated'`, so a leaked URL is useless without a
 *    fresh server-minted signature.
 *  - Nothing is ever rendered inline in the admin panel from these; they are
 *    download links behind a short-lived signature.
 *
 * NEVER import on the frontend — API_SECRET must stay server-side only.
 */

import crypto from 'crypto';
import path from 'path';
import cloudinary from '../config/cloudinary.js';
import { putPrivateAsset } from '../services/storage/privateUploads.js';
import { providerOf, r2PrivateUrl } from '../services/storage/privateAssetUrl.js';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_ALLOWED_EXT,
} from '../config/supportPolicy.js';

/** Base folder every support attachment is constrained to. */
export const SUPPORT_FOLDER_BASE = 'autobacs/support';

/** How long an admin's signed view/download link stays valid. */
const DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Decide whether an attachment may be stored.
 *
 * @param {{ Name?: string, ContentType?: string, ContentLength?: number, Content?: string }} att
 * @returns {{ ok: boolean, reason?: string }}
 */
export const validateAttachment = (att = {}) => {
  const name = String(att.Name || '').trim();
  const mime = String(att.ContentType || '').split(';')[0].trim().toLowerCase();
  // Postmark reports ContentLength, but it is only a claim; the decoded byte
  // length below is what is actually enforced.
  const ext = path.extname(name).toLowerCase();

  if (!name) return { ok: false, reason: 'missing filename' };
  if (!ATTACHMENT_ALLOWED_MIME.includes(mime)) {
    return { ok: false, reason: `unsupported type (${mime || 'unknown'})` };
  }
  if (!ATTACHMENT_ALLOWED_EXT.includes(ext)) {
    return { ok: false, reason: `unsupported extension (${ext || 'none'})` };
  }
  return { ok: true };
};

/**
 * Upload one validated attachment to private Cloudinary storage.
 *
 * @param {Object} att - a Postmark inbound attachment
 * @param {string} folder - server-computed subfolder
 * @returns {Promise<Object>} the persisted attachment shape
 */
const uploadOne = async (att, folder) => {
  const mime = String(att.ContentType || '').split(';')[0].trim().toLowerCase();
  const buffer = Buffer.from(String(att.Content || ''), 'base64');

  /*
    The stored name is server-generated, unguessable, and unrelated to the
    sender's filename — which is attacker-controlled on an inbound email and is
    how a `.html` or `.svg` ends up addressable on our own domain. The extension
    comes from the ALLOWLIST validateAttachment already matched, never from the
    name itself; it exists only so the object is recognisable in a bucket
    listing.
  */
  const ext = path.extname(String(att.Name || '')).toLowerCase();
  const safeExt = ATTACHMENT_ALLOWED_EXT.includes(ext) ? ext : '';
  const basename = `${crypto.randomBytes(12).toString('hex')}${safeExt}`;

  const stored = await putPrivateAsset({
    buffer,
    folder,
    basename,
    contentType: mime,
    // Support attachments are already `type: 'authenticated'` on Cloudinary;
    // keeping that is what makes a leaked URL useless without a signature.
    cloudinaryPrivate: true,
    // The basename is random, so an overwrite could only ever mean a collision
    // we would rather hear about than silently absorb.
    overwrite: false,
  });

  return {
    publicId: stored.publicId,
    provider: stored.provider,
    resourceType: stored.resourceType,
    fileName: String(att.Name || '').slice(0, 255),
    contentType: mime,
    bytes: stored.bytes || buffer.length,
  };
};

/**
 * Store the attachments from an inbound email.
 *
 * Never throws for a single bad file: a malformed attachment must not cost us
 * the customer's actual message. Failures come back in `rejected` so an agent
 * can see what was dropped and ask for a resend, rather than the evidence
 * silently vanishing.
 *
 * @param {Array} attachments - Postmark inbound `Attachments`
 * @param {string} reference - ticket reference, used to namespace the folder
 * @returns {Promise<{ stored: Array, rejected: Array }>}
 */
export const storeInboundAttachments = async (attachments = [], reference = 'unknown') => {
  const stored = [];
  const rejected = [];

  const list = Array.isArray(attachments) ? attachments : [];
  const folder = `${SUPPORT_FOLDER_BASE}/${reference}`;

  for (const att of list) {
    const name = String(att?.Name || '').slice(0, 255);
    const mime = String(att?.ContentType || '').split(';')[0].trim().toLowerCase();

    if (stored.length >= ATTACHMENT_MAX_COUNT) {
      rejected.push({ fileName: name, contentType: mime, bytes: 0, reason: 'too many attachments' });
      continue;
    }

    const verdict = validateAttachment(att);
    if (!verdict.ok) {
      rejected.push({ fileName: name, contentType: mime, bytes: 0, reason: verdict.reason });
      continue;
    }

    // Enforce the cap on the DECODED length, not the provider's claimed one.
    // base64 inflates by ~4/3, so this is the only honest measure.
    const declared = String(att.Content || '');
    const approxBytes = Math.floor((declared.length * 3) / 4);
    if (approxBytes > ATTACHMENT_MAX_BYTES) {
      rejected.push({
        fileName: name,
        contentType: mime,
        bytes: approxBytes,
        reason: `exceeds ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB limit`,
      });
      continue;
    }

    try {
      stored.push(await uploadOne(att, folder));
    } catch (err) {
      console.error(`[SupportAttachments] Upload failed for "${name}":`, err?.message);
      rejected.push({ fileName: name, contentType: mime, bytes: approxBytes, reason: 'upload failed' });
    }
  }

  return { stored, rejected };
};

/**
 * Mint a short-lived signed URL so an admin can view/download a private
 * attachment. Generation itself sits behind admin auth in the route.
 *
 * Raw assets (PDF/txt) need the private-download API rather than a signed
 * delivery URL, because Cloudinary blocks raw delivery by default — the same
 * split documented in utils/careersCloudinary.js.
 *
 * @param {string} publicId
 * @param {'image'|'video'|'raw'} resourceType
 * @returns {string}
 */
export const signedAttachmentUrl = async (publicId, resourceType, ref) => {
  if (!publicId) return '';

  /*
    During the Cloudinary -> R2 migration both stores hold live assets, so
    the read path resolves either. `ref` is the stored file reference; when
    it is absent or carries no provider the asset predates the migration and
    is Cloudinary — see providerOf(). Routing on an explicit field rather
    than the shape of the id, which is identical between the two.
  */
  if (providerOf(ref) === 'r2') {
    return r2PrivateUrl({ key: publicId, });
  }

  const rt = resourceType || 'raw';
  if (rt === 'raw') {
    return cloudinary.utils.private_download_url(publicId, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.round(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS,
    });
  }
  return cloudinary.url(publicId, {
    resource_type: rt,
    type: 'authenticated',
    sign_url: true,
    secure: true,
  });
};

export default {
  SUPPORT_FOLDER_BASE,
  validateAttachment,
  storeInboundAttachments,
  signedAttachmentUrl,
};
