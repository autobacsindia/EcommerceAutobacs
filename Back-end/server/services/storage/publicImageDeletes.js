/**
 * Delete public catalog images from whichever store holds them.
 *
 * The private twin of this is careersAssetStore/privateUploads; this is the
 * public-bucket side, used by every path that removes a product (or brand,
 * category, vehicle…) image.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The controllers called `deleteManyFromCloudinary(publicIds)` unconditionally.
 * Since STORAGE_PROVIDER flipped to r2, a product image's `public_id` IS an R2
 * object key — so removing an image asked Cloudinary to delete an R2 key,
 * Cloudinary answered `not_found`, the call reported success, and the object was
 * orphaned permanently. Silent, and it compounds: every edit leaks.
 *
 * ── Routing is on the URL, not the id ───────────────────────────────────────
 * A Cloudinary public_id and an R2 object key are the same shape
 * (`autobacs/products/<id>/<name>`), so the id alone cannot say where an asset
 * lives. The stored `url` can: it carries the host. Every call site has the full
 * ref to hand, so nothing has to guess.
 *
 * ── Variants are derivatives and go with the original ───────────────────────
 * An R2 original has ~14 pre-generated variants. Deleting the original alone
 * would strand all of them — roughly 14 orphans per removed image, which is how
 * a bucket quietly fills with objects nothing will ever reference again.
 */
import { deleteObject, deleteObjects, listKeys } from './r2Provider.js';
import { variantPrefixFor } from './variants.js';
import { isHostedImageUrl } from '../../models/Product.js';
import { deleteManyFromCloudinary } from '../../utils/cloudinaryHelpers.js';

/**
 * Does this ref live in R2?
 *
 * `isHostedImageUrl` accepts BOTH providers, so it cannot be used alone — a
 * Cloudinary URL passes it too. The R2 test is an exact host match against
 * R2_PUBLIC_BASE_URL, and a URL we do not recognise at all is treated as
 * Cloudinary, which is the pre-migration default everywhere else.
 */
export const isR2Image = (url) => {
  const base = process.env.R2_PUBLIC_BASE_URL || '';
  if (!base || typeof url !== 'string' || !url) return false;
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
};

/**
 * Delete a batch of catalog images, routing each to its own store.
 *
 * Never throws: every caller is on a cleanup path where the database is already
 * consistent, and a storage failure must not unwind a successful save. Failures
 * are logged under [CLEANUP_REQUIRED] so the existing log alert catches them.
 *
 * @param {Array<{public_id?:string, publicId?:string, url?:string}>} refs
 * @returns {Promise<{r2:number, cloudinary:number, variants:number}>}
 */
export const deleteHostedImages = async (refs = []) => {
  const list = (Array.isArray(refs) ? refs : []).filter(Boolean);
  const r2Keys = [];
  const cloudinaryIds = [];

  for (const ref of list) {
    const id = ref.public_id || ref.publicId;
    if (!id) continue;
    (isR2Image(ref.url) ? r2Keys : cloudinaryIds).push(id);
  }

  let variants = 0;

  if (r2Keys.length) {
    try {
      // Derivatives first: if the original goes and this fails, the variants are
      // still findable by prefix. The reverse order would strand them nameless.
      const variantKeys = [];
      for (const key of r2Keys) {
        const prefix = variantPrefixFor(key);
        if (!prefix) continue;
        // eslint-disable-next-line no-await-in-loop
        const found = await listKeys({ prefix, scope: 'public' });
        found.forEach((o) => variantKeys.push(o.key));
      }
      if (variantKeys.length) {
        const res = await deleteObjects({ keys: variantKeys, scope: 'public' });
        variants = res.deleted;
      }
      await Promise.all(r2Keys.map((key) => deleteObject({ key, scope: 'public' })));
    } catch (err) {
      console.error(`[CLEANUP_REQUIRED][Storage] r2 image cleanup failed: ${err.message}`);
    }
  }

  if (cloudinaryIds.length) {
    try {
      await deleteManyFromCloudinary(cloudinaryIds);
    } catch (err) {
      console.error(`[CLEANUP_REQUIRED][Storage] cloudinary image cleanup failed: ${err.message}`);
    }
  }

  return { r2: r2Keys.length, cloudinary: cloudinaryIds.length, variants };
};

export { isHostedImageUrl };
export default { isR2Image, deleteHostedImages };
