/**
 * Server-side writes of private artefacts: support-email attachments, courier
 * shipping slips, invoice PDFs.
 *
 * These differ from the careers/returns flows in one structural way — the bytes
 * are already on OUR server (an inbound webhook payload, a multer buffer, a PDF
 * we just rendered), so there is no presigned URL and no browser involved. One
 * helper covers all three because the shape is identical: buffer in, a stored
 * ref out.
 *
 * ── The ref is what matters, not the URL ────────────────────────────────────
 * Every caller persists `{ publicId, provider, bytes }` and resolves a URL at
 * READ time. That is what lets the two stores coexist: a slip written to
 * Cloudinary last month and one written to R2 today are both readable, and
 * flipping `STORAGE_PROVIDER` back does not strand either.
 *
 * ── A deliberate asymmetry: slips and invoices become PRIVATE on R2 ─────────
 * On Cloudinary, shipping slips and invoices are stored as ordinary public
 * `raw` assets — a permanent, unauthenticated URL to a PDF carrying a
 * customer's name and delivery address. Nothing external depends on that being
 * public: the shipping email ATTACHES the slip (the server fetches it and
 * attaches the bytes), and the admin console renders a link we can mint per
 * view. So on R2 they go to the private bucket and are read through a
 * short-lived signed URL.
 *
 * The Cloudinary branch keeps its existing behaviour exactly. Making it
 * `authenticated` would 401 every URL already stored in Mongo. So visibility
 * follows the provider — which is fine, because every read path resolves the
 * provider from the ref rather than assuming one.
 */
import cloudinary from '../../config/cloudinary.js';
import { putObject, deleteObject, getObjectBuffer } from './r2Provider.js';
import { storageProvider } from '../../config/storage.js';
import { providerOf } from './privateAssetUrl.js';
import { PRIVATE_PREFIXES } from './assetScope.js';
import AppError from '../../utils/AppError.js';

/**
 * Cloudinary's `resource_type` for a MIME type. Images are decoded and
 * transformable; everything else is stored as opaque bytes.
 *
 * R2 has no equivalent concept — it stores bytes either way — but the value is
 * persisted on the ref so a Cloudinary-era asset can still be read back with the
 * resource type it was written under.
 */
export const resourceTypeFor = (contentType) => {
  const t = String(contentType || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/') || t.startsWith('audio/')) return 'video';
  return 'raw';
};

/**
 * Store one private artefact.
 *
 * @param {object}  opts
 * @param {Buffer}  opts.buffer
 * @param {string}  opts.folder       server-computed; must be a PRIVATE_PREFIXES entry
 * @param {string}  opts.basename     server-generated; carries the extension for raw
 * @param {string}  opts.contentType
 * @param {boolean} [opts.overwrite=false]
 *        Cloudinary only — whether re-uploading the same public_id replaces the
 *        object. True where the id is DETERMINISTIC and a re-run should replace
 *        (an invoice re-rendered for the same order); false where the id is
 *        random and an overwrite could only ever mean a collision we want to
 *        hear about. R2's PUT is unconditionally last-write-wins, which is
 *        equivalent for deterministic ids and unreachable for random ones.
 * @param {boolean} [opts.cloudinaryPrivate=false]
 *        Whether the CLOUDINARY branch stores this as `type: 'authenticated'`.
 *        Per-caller because it must match what that caller already writes —
 *        support attachments are authenticated today, slips and invoices are
 *        not, and changing either would break URLs already in Mongo. The R2
 *        branch ignores it: the private bucket is the only destination here.
 * @returns {Promise<{publicId:string, provider:'r2'|'cloudinary', bytes:number, resourceType:string, url:string}>}
 *        `url` is '' on the R2 path — a private object has no permanent address,
 *        and a caller that stored one would be handing out an unauthenticated
 *        link to a customer's paperwork.
 */
export const putPrivateAsset = async ({
  buffer, folder, basename, contentType, cloudinaryPrivate = false, overwrite = false,
}) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new AppError('putPrivateAsset requires a non-empty buffer', 500);
  }
  if (!folder || !basename) {
    throw new AppError('putPrivateAsset requires a folder and a basename', 500);
  }
  const resourceType = resourceTypeFor(contentType);

  if (storageProvider() === 'r2') {
    const key = `${folder}/${basename}`;
    await putObject({ body: buffer, key, scope: 'private', contentType });
    return { publicId: key, provider: 'r2', bytes: buffer.length, resourceType, url: '' };
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: basename,
        resource_type: resourceType,
        ...(cloudinaryPrivate ? { type: 'authenticated' } : {}),
        overwrite,
      },
      (error, result) => {
        if (error) {
          return reject(new AppError(`Cloudinary upload failed: ${error.message}`, 500));
        }
        resolve({
          publicId: result.public_id,
          provider: 'cloudinary',
          bytes: result.bytes || buffer.length,
          resourceType,
          url: result.secure_url || '',
        });
      },
    );
    stream.end(buffer);
  });
};

/**
 * Delete one private artefact from whichever store holds it.
 *
 * Routed by the ref's OWN provider, never by the current STORAGE_PROVIDER. An
 * S3 delete of a key that is not there SUCCEEDS, so a delete aimed at the wrong
 * store reports done while the object survives — for an orphaned shipping slip
 * that means a PDF with a customer's address left in a bucket with nothing
 * referencing it, which no later sweep will attribute to anyone.
 *
 * Never throws: every caller is already on an error path, tidying up after a
 * write that could not be committed. A failed cleanup must not replace the
 * message the operator actually needs to see. Failures are logged under
 * [CLEANUP_REQUIRED] so the existing log alert catches them.
 *
 * @returns {Promise<boolean>} true when the object is gone
 */
export const deletePrivateAsset = async ({ publicId, resourceType = 'raw', provider } = {}) => {
  const id = String(publicId || '').trim();
  if (!id) return false;

  // Confine deletes to the private tree. These helpers are reachable from
  // request handlers, and an id that reached one of them from a payload must
  // never be able to address a product image or an arbitrary object.
  if (!PRIVATE_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}/`))) {
    console.error(`[CLEANUP_REQUIRED] refused delete outside the private tree: ${id}`);
    return false;
  }

  if (providerOf({ provider }) === 'r2') {
    // deleteObject logs under [CLEANUP_REQUIRED] and returns false rather than
    // throwing; a miss must be reported as not-done so callers do not record a
    // cleanup that never happened.
    return deleteObject({ key: id, scope: 'private' });
  }

  try {
    const res = await cloudinary.api.delete_resources([id], { resource_type: resourceType });
    const status = res?.deleted?.[id];
    // `not_found` is success: the goal is "the object is not there", and a
    // retried cleanup must be able to finish rather than jam on work already done.
    return status === 'deleted' || status === 'not_found';
  } catch (err) {
    console.error(`[CLEANUP_REQUIRED] cloudinary delete failed ${id}: ${err.message}`);
    return false;
  }
};

/**
 * Read a private artefact's bytes SERVER-SIDE, from whichever store holds it.
 *
 * For attaching a PDF to an email, not for handing anything to a browser. On R2
 * this reads the object directly rather than presigning a URL and fetching it
 * over HTTP — the extra round trip would buy nothing and would put a bearer
 * credential for a customer's paperwork into a log line somewhere.
 *
 * The Cloudinary branch still fetches the stored `url`, because that is the only
 * handle a Cloudinary-era ref has.
 *
 * @param {object}   ref                 { publicId, provider, url }
 * @param {Function} fetchUrl            downloader for the Cloudinary branch
 * @returns {Promise<Buffer>}            throws if the object cannot be read
 */
export const readPrivateAsset = async (ref, fetchUrl) => {
  if (providerOf(ref) === 'r2') {
    if (!ref?.publicId) throw new AppError('readPrivateAsset: ref has no publicId', 500);
    return getObjectBuffer({ key: ref.publicId, scope: 'private' });
  }
  if (!ref?.url) throw new AppError('readPrivateAsset: ref has no url', 500);
  return fetchUrl(ref.url);
};

export default { resourceTypeFor, putPrivateAsset, deletePrivateAsset, readPrivateAsset };
