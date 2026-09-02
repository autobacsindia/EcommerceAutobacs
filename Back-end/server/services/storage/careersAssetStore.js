/**
 * Everything the careers flow does to a stored file, routed by provider.
 *
 * There are four places that touch a careers asset — submit-time verification,
 * orphan cleanup, the 14-day retention purge, and its CLI twin — and during the
 * Cloudinary → R2 migration each of them has to work against BOTH stores. Doing
 * that routing four times is how one of them gets missed, and the one that gets
 * missed is silent: media that is never purged looks exactly like media that
 * was. Given that stranded careers PII has already cost this codebase 2.98 GB
 * of unattributable CVs, the routing lives in exactly one module.
 *
 * ── Routing is per-FILE, not per-deployment ─────────────────────────────────
 * Every stored ref carries its own `provider`, and reads/deletes follow the ref
 * rather than the current `STORAGE_PROVIDER`. That is what makes the cutover
 * (and the rollback) safe: applications submitted before the flip stay readable
 * and purgeable after it. A ref written before the field existed has no value,
 * and absent MUST mean Cloudinary — the same rule as privateAssetUrl.providerOf.
 *
 * ── What verification can and cannot prove ──────────────────────────────────
 * Cloudinary DECODED every upload and reported a real format. R2 stores bytes
 * and reports only what the uploader claimed — it does not even enforce the
 * Content-Type its own presigned PUT was signed with (verified against the live
 * bucket). So the R2 path re-derives the format itself, by reading the first
 * bytes back out and identifying the file by its magic number.
 *
 * That is a different guarantee, not the same one: a file can carry a valid
 * container signature and still be corrupt further in. What it reliably stops is
 * the substitution that matters — arbitrary bytes (HTML, an executable, an
 * archive) parked in a slot that is supposed to hold a PDF.
 */
import { providerOf } from './privateAssetUrl.js';
import { headObject, getObjectHead, deleteObject } from './r2Provider.js';
import { matchesSlot, SNIFF_BYTES } from './contentSniff.js';
import { slotFromKey } from './careersUploadTargets.js';
import {
  CAREERS_FOLDER_BASE,
  getCareersResource,
  deleteCareersAsset,
} from '../../utils/careersCloudinary.js';

// Re-exported so careers call sites keep one import; the constant belongs with
// the sniffer that defines what it has to be big enough to see.
export { SNIFF_BYTES };

/** Why a file failed verification. The caller owns the applicant-facing copy. */
export const REASON = {
  INVALID_REF: 'invalid-ref',   // not a reference we could have issued
  MISSING: 'missing',           // never uploaded, or uploaded somewhere else
  TOO_LARGE: 'too-large',
  WRONG_TYPE: 'wrong-type',
};

const fail = (reason) => ({ ok: false, reason });

/**
 * Cloudinary reports `format` for decoded media; `raw` resources (PDFs) carry
 * the extension in the public_id instead.
 *
 * NOTE this is an extension check for raw — the bytes were never decoded. It is
 * one layer alongside the folder scope, the size cap and `authenticated`
 * storage, and it is strictly weaker than the R2 path's magic-byte check below.
 */
const cloudinaryFormat = (resource, publicId) => {
  if (resource.format) return String(resource.format).toLowerCase();
  const m = String(publicId).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};

/**
 * Verify one submitted file against the store that actually holds it.
 *
 * @param {object} opts
 * @param {object} opts.ref   { publicId, provider } — the client's claim
 * @param {object} opts.slot  the FILE_SLOTS entry (resourceType, max, formats, key)
 * @returns {Promise<{ok:true, bytes:number, provider:string} | {ok:false, reason:string}>}
 */
export const verifyCareersAsset = async ({ ref, slot }) => {
  const publicId = String(ref?.publicId || '').trim();
  if (!publicId || !slot) return fail(REASON.INVALID_REF);

  /*
    The client tells us WHERE it uploaded, and we verify there. That is safe
    because a lie cannot manufacture a pass — it only sends us looking in a store
    that does not hold the file, and the lookup fails. Routing on the server's
    current STORAGE_PROVIDER instead would break every applicant who was
    mid-application when the flag flipped.
  */
  const provider = providerOf(ref);

  if (provider === 'r2') {
    /*
      One check replaces three. `slotFromKey` matches the WHOLE minted key shape
      (prefix, 24-hex applicant folder, slot, 16-hex nonce, extension), so it
      simultaneously proves the object is inside our careers prefix, that we
      minted it, that it carries no traversal segments, and that it was signed
      for the slot it is now being attached to. Anything else fails closed.
    */
    if (slotFromKey(publicId) !== slot.key) return fail(REASON.INVALID_REF);

    const head = await headObject({ key: publicId, scope: 'private' });
    if (!head) return fail(REASON.MISSING);
    // Size comes from the store, never from the client — this is the cap.
    if (head.bytes > slot.max) return fail(REASON.TOO_LARGE);
    // A zero-byte object means the PUT was started and abandoned.
    if (head.bytes <= 0) return fail(REASON.MISSING);

    const magic = await getObjectHead({ key: publicId, scope: 'private', bytes: SNIFF_BYTES });
    if (!matchesSlot(magic, slot.resourceType)) return fail(REASON.WRONG_TYPE);

    return { ok: true, bytes: head.bytes, provider: 'r2' };
  }

  if (!publicId.startsWith(`${CAREERS_FOLDER_BASE}/`)) return fail(REASON.INVALID_REF);

  const resource = await getCareersResource(publicId, slot.resourceType);
  if (!resource) return fail(REASON.MISSING);
  if (resource.bytes > slot.max) return fail(REASON.TOO_LARGE);
  const format = cloudinaryFormat(resource, publicId);
  if (slot.formats && !slot.formats.includes(format)) return fail(REASON.WRONG_TYPE);

  return { ok: true, bytes: resource.bytes, provider: 'cloudinary' };
};

/**
 * Which store holds an asset we know only by its id.
 *
 * INFERENCE OF LAST RESORT — used only by the orphan-cleanup endpoint, which
 * receives bare ids from a browser that has already failed once and may not have
 * told us where it uploaded. Everywhere else the provider is read from the
 * stored ref, which is authoritative; never call this when a ref is available.
 *
 * The shapes are unambiguous: an R2 key is one WE minted
 * (`autobacs/careers/<24hex>/<slot>-<16hex>.<ext>`), while a Cloudinary
 * public_id carries Cloudinary's own random basename and never matches it.
 *
 * Trying both stores instead would be actively wrong: an S3 delete of a key that
 * does not exist SUCCEEDS, so the R2 attempt would report "deleted" for a file
 * still sitting in Cloudinary — a cleanup that silently strands the PII it was
 * written to remove.
 */
export const inferCareersProvider = (publicId) =>
  (slotFromKey(publicId) ? 'r2' : 'cloudinary');

/**
 * Delete one careers asset from whichever store holds it.
 *
 * Never throws, and "already gone" counts as success: every caller's goal is
 * "this object is not there", and a retried purge must be able to finish rather
 * than reporting failure for work that is already done. A purge that cannot
 * complete is a retention breach, so the failure is logged loudly under a
 * greppable tag rather than swallowed.
 *
 * @returns {Promise<boolean>} true when the object is gone
 */
export const deleteCareersAssetAnywhere = async ({ publicId, resourceType, provider } = {}) => {
  const id = String(publicId || '').trim();
  if (!id) return false;

  if (providerOf({ provider }) === 'r2') {
    // The prefix guard is the R2 twin of deleteCareersAsset's: this function is
    // reachable from a public cleanup endpoint, so it must never be able to
    // delete outside the careers tree.
    if (!id.startsWith(`${CAREERS_FOLDER_BASE}/`)) return false;
    // deleteObject already logs under [CLEANUP_REQUIRED] and returns false
    // rather than throwing; a delete that missed must be reported as not-done,
    // never as done, or the retention sweep will stamp mediaPurgedAt over files
    // that are still sitting in the bucket.
    return deleteObject({ key: id, scope: 'private' });
  }

  return deleteCareersAsset(id, resourceType);
};

export default { SNIFF_BYTES, REASON, verifyCareersAsset, deleteCareersAssetAnywhere };
