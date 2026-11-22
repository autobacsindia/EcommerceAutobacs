/**
 * Private storage for supplier documents and listing photos.
 *
 * Bytes go through the existing private-upload helpers (services/storage/*): the
 * file type is decided from the BYTES (attachmentCheck → contentSniff), never the
 * label, and everything lands under the `supplier-portal/` private prefix
 * (services/storage/assetScope.js). Reads are short-lived signed URLs minted per
 * response; there is never a permanent public link.
 */
import crypto from 'crypto';
import { putPrivateAsset, deletePrivateAsset } from '../storage/privateUploads.js';
import { checkAttachments } from '../storage/attachmentCheck.js';
import { signedAttachmentUrl } from '../../utils/supportAttachments.js';
import { fail } from './errors.js';

export const PORTAL_FOLDER = 'supplier-portal';

const resourceTypeOf = (contentType) => (String(contentType).startsWith('image/') ? 'image' : 'raw');

/**
 * Validate + store files. Returns refs `{ key, provider, contentType }`.
 * If any store fails, the ones already stored are removed before throwing.
 */
export async function storeFiles(files, { folder, prefix, allowPdf, max, noun }) {
  let checked;
  try {
    checked = checkAttachments(files, { allowPdf, max, noun });
  } catch (err) {
    throw fail(400, 'BAD_FILE', err.message);
  }
  if (!checked.length) throw fail(400, 'NO_FILE', `Choose a ${noun} to upload.`);
  const stored = [];
  try {
    for (const { file, contentType, ext } of checked) {
       
      const ref = await putPrivateAsset({
        buffer: file.buffer,
        folder: `${PORTAL_FOLDER}/${folder}`,
        basename: `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
        contentType,
        cloudinaryPrivate: true,
      });
      stored.push({ key: ref.publicId, provider: ref.provider, contentType });
    }
  } catch (err) {
    await removeFiles(stored);
    throw err;
  }
  return stored;
}

/** Best-effort delete (never throws; failures are logged [CLEANUP_REQUIRED] by the helper). */
export const removeFiles = (refs = []) => Promise.all(refs.filter((r) => r?.key).map((r) => deletePrivateAsset({
  publicId: r.key, provider: r.provider, resourceType: resourceTypeOf(r.contentType),
})));

/**
 * key → short-lived URL for the images of these listings. Failures map to null.
 * `coverOnly` signs just the first photo of each listing: presigning is ~0.2 ms
 * of CPU per URL (measured), so a 50-row page × 6 photos cost ~63 ms per request
 * for photos the list screen never shows.
 */
export async function signedUrlMap(listings = [], { coverOnly = false } = {}) {
  const refs = listings.flatMap((l) => (coverOnly ? (l?.images || []).slice(0, 1) : (l?.images || [])));
  const entries = await Promise.all(refs.map(async (r) => {
    try {
      return [r.key, (await signedAttachmentUrl(r.key, resourceTypeOf(r.contentType), r)) || null];
    } catch (err) {
      console.warn(`[PARTNER] could not sign a listing photo url: ${err.message}`);
      return [r.key, null];
    }
  }));
  return new Map(entries);
}
