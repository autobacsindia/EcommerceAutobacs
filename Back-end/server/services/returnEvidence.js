/**
 * Return evidence — the customer's (or, for a staff-raised return, the customer's own
 * photos and videos uploaded by staff) unboxing video, proof of purchase and photos.
 *
 * Shared by the storefront route (returnController) and the team panel
 * (services/returnService.js) so a photo is verified exactly the same way whoever
 * uploads it. Uploads go straight from the browser to private storage under a
 * server-chosen folder; only the reference comes back, and every reference is
 * RE-VERIFIED against the store here (size, type, that we minted it) — never trusted.
 */

import AppError from '../utils/AppError.js';
import {
  RETURNS_FOLDER_BASE,
  generateReturnUploadSignature,
  getReturnResource,
  signedReturnAssetUrl,
  resourceFormat,
} from '../utils/returnsCloudinary.js';
import { storageProvider } from '../config/storage.js';
import { providerOf } from './storage/privateAssetUrl.js';
import { headObject, getObjectHead } from './storage/r2Provider.js';
import { matchesAnyKind, SNIFF_BYTES } from './storage/contentSniff.js';
import {
  RETURN_SLOTS,
  newReturnsFolder,
  slotFromKey,
  slotDefFromKey,
  buildReturnUploadTargets,
} from './storage/returnsUploadTargets.js';

export const MB = 1024 * 1024;
export const VIDEO_MAX_BYTES = 60 * MB;
export const PROOF_MAX_BYTES = 15 * MB;
export const PHOTO_MAX_BYTES = 10 * MB;
export const MAX_PHOTOS = 5;

export const VIDEO_FORMATS = ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'ogg', '3gp', '3gpp', 'avi', 'mkv', 'quicktime', 'x-matroska', 'mpeg', 'mpg'];
export const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
export const PROOF_FORMATS = [...IMAGE_FORMATS, 'pdf'];

/**
 * Validate ONE client-declared asset against Cloudinary. The only value trusted
 * from the client is publicId (+ a constrained resourceType); size/format are
 * re-read server-side. Returns { publicId, resourceType, bytes } or throws a
 * response-shaped Error via `fail`.
 */
export const validateAsset = async (raw, { label, allowedResourceTypes, maxBytes, formats, capLabel, slotKeys }) => {
  if (!raw || typeof raw !== 'object') return null;
  const publicId = typeof raw.publicId === 'string' ? raw.publicId.trim() : '';
  if (!publicId) return null;

  /*
    The client says WHERE it uploaded, and we verify there. Safe to take at face
    value: a lie cannot manufacture a pass, it only sends the lookup to a store
    that does not hold the file. Routing on the server's current
    STORAGE_PROVIDER instead would reject every customer who was mid-form when
    the flag flipped. Absent means Cloudinary — the rule everywhere else.
  */
  if (providerOf(raw) === 'r2') {
    /*
      One check replaces three. slotFromKey matches the WHOLE minted key shape,
      so it proves at once that the object is inside our returns prefix, that we
      minted it, that it carries no traversal segments, and that it was signed
      for a slot this field accepts — the last of which stops evidence being
      shuffled between slots to dodge a size cap.
    */
    const slotKey = slotFromKey(publicId);
    if (!slotKey || (slotKeys && !slotKeys.includes(slotKey))) {
      throw new AppError(`${label}: invalid upload reference.`, 400);
    }
    const slotDef = slotDefFromKey(publicId);

    const head = await headObject({ key: publicId, scope: 'private' });
    if (!head || head.bytes <= 0) {
      throw new AppError(`${label}: upload could not be verified. Please re-upload.`, 400);
    }
    // The cap is enforced against the STORE, never the payload's claim.
    if (head.bytes > maxBytes) {
      throw new AppError(`${label} exceeds the ${capLabel} limit.`, 400);
    }
    /*
      R2 does not decode uploads the way Cloudinary did, and does not even
      enforce the Content-Type its own presigned URL was signed with. So the
      format is re-derived from the bytes: a ranged read of the first few
      hundred, identified by magic number.
    */
    const magic = await getObjectHead({ key: publicId, scope: 'private', bytes: SNIFF_BYTES });
    if (!matchesAnyKind(magic, slotDef?.kinds)) {
      throw new AppError(`${label}: unsupported file type.`, 400);
    }
    return {
      publicId,
      resourceType: slotDef?.resourceType || allowedResourceTypes[0],
      bytes: head.bytes,
      provider: 'r2',
    };
  }

  let resourceType = typeof raw.resourceType === 'string' ? raw.resourceType.trim() : allowedResourceTypes[0];
  if (!allowedResourceTypes.includes(resourceType)) {
    throw new AppError(`${label}: invalid upload type.`, 400);
  }
  // Must live under our returns folder — blocks attaching a foreign asset by id.
  if (!publicId.startsWith(`${RETURNS_FOLDER_BASE}/`)) {
    throw new AppError(`${label}: invalid upload reference.`, 400);
  }

  const resource = await getReturnResource(publicId, resourceType);
  if (!resource) {
    throw new AppError(`${label}: upload could not be verified. Please re-upload.`, 400);
  }
  if (resource.bytes > maxBytes) {
    throw new AppError(`${label} exceeds the ${capLabel} limit.`, 400);
  }
  const fmt = resourceFormat(resource, publicId);
  if (formats && !formats.includes(fmt)) {
    throw new AppError(`${label}: unsupported file type.`, 400);
  }
  return { publicId, resourceType, bytes: resource.bytes, provider: 'cloudinary' };
};


const PHOTO_SLOT_KEYS = RETURN_SLOTS.filter((sl) => sl.key.startsWith('photo')).map((sl) => sl.key);

/** A verified video reference, or null when none was given. */
export const verifyVideo = (raw, label = 'Video') => validateAsset(raw, {
  label, allowedResourceTypes: ['video'], maxBytes: VIDEO_MAX_BYTES, formats: VIDEO_FORMATS, capLabel: '60MB',
  slotKeys: ['video'],
});

/** A verified proof-of-purchase reference (photo or PDF), or null when none was given. */
export const verifyProof = (raw) => validateAsset(raw, {
  label: 'Proof of purchase', allowedResourceTypes: ['image', 'raw'], maxBytes: PROOF_MAX_BYTES, formats: PROOF_FORMATS, capLabel: '15MB',
  slotKeys: ['proof'],
});

/** Verified photo references (at most MAX_PHOTOS; empty entries dropped). */
export const verifyPhotos = async (raws) => {
  const out = [];
  for (const raw of (Array.isArray(raws) ? raws.slice(0, MAX_PHOTOS) : [])) {
    const a = await validateAsset(raw, {
      label: 'Photo', allowedResourceTypes: ['image'], maxBytes: PHOTO_MAX_BYTES, formats: IMAGE_FORMATS, capLabel: '10MB',
      slotKeys: PHOTO_SLOT_KEYS,
    });
    if (a) out.push(a);
  }
  return out;
};

/**
 * Where the browser may upload evidence: a discriminated union on `provider` (see
 * returnController.getReturnUploadSignature for why). Not bound to a user — the
 * folder is a fresh unguessable nonce, and every reference is re-verified on submit.
 */
export const uploadTargets = async (files) => {
  const folder = newReturnsFolder();
  if (storageProvider() === 'r2') {
    return { provider: 'r2', folder, uploads: await buildReturnUploadTargets({ folder, files }) };
  }
  return { provider: 'cloudinary', ...generateReturnUploadSignature({ folder }) };
};

/** Signed, viewable copies of a return's private evidence (staff and admin only). */
// Async because signing an R2 asset is a presign call rather than a local HMAC.
// Every asset on the return is signed in one parallel batch.
export const withSignedEvidence = async (rr) => {
  // `a` is passed whole so the minter can read its `provider` — a ref written
  // before the R2 migration has none, which correctly means Cloudinary.
  const sign = async (a) => (a?.publicId
    ? {
      url: await signedReturnAssetUrl(a.publicId, a.resourceType, a),
      bytes: a.bytes || 0,
      resourceType: a.resourceType,
    }
    : null);

  const images = Array.isArray(rr.images) ? rr.images : [];
  const [video, proofOfPurchase, signedImages] = await Promise.all([
    sign(rr.video),
    sign(rr.proofOfPurchase),
    Promise.all(images.map(sign)),
  ]);

  return { ...rr, video, proofOfPurchase, images: signedImages.filter(Boolean) };
};

export default { validateAsset, verifyVideo, verifyProof, verifyPhotos, uploadTargets, withSignedEvidence };
