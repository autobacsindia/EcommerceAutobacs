/**
 * Resolve which image represents a product, or one selectable model of it.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * A variable product's models each MAY point at one entry in the parent's
 * gallery (`variant.imageKey`, holding that entry's `imageKey()`). Most do not,
 * and that is a normal, permanent state — not missing data. Resolution falls
 * back down a chain, so every caller gets the best available image without
 * having to know whether this product has models at all:
 *
 *     variant.imageKey → the matching gallery entry
 *                      → the gallery's primary
 *                      → the first gallery entry
 *                      → null   (caller renders its own placeholder)
 *
 * ── Why this is resolved at READ time and never stored ──────────────────────
 * The obvious shortcut is to copy the parent's main image onto every variant at
 * write time so reads are a plain field access. That is wrong in three ways:
 * changing the product's main photo would leave every copy stale; deleting it
 * would leave copies pointing at a dead URL; and cleanup could no longer tell a
 * real model photo from a copy of the parent's, so it could not decide whether
 * an asset is still referenced. Absent must keep meaning "whatever the product's
 * main image is right now".
 *
 * ── Why a dangling key is not an error ──────────────────────────────────────
 * An admin can remove a gallery image that a model points at. The write path
 * clears such pointers, but a stale key can still reach a read (a concurrent
 * edit, a cached document, a legacy row). Falling through to the product image
 * makes that cosmetic. Throwing, or returning null, would put a hole in a live
 * PDP over a bookkeeping mismatch.
 *
 * Shared by the PDP payload, cart lines, order snapshots and both ad feeds so
 * "which image represents this model" has exactly one definition. The frontend
 * twin is Front-end/web/src/lib/variantImage.ts — keep them in step.
 */
import { imageKey } from './productGallery.js';

/**
 * The product's own representative image: its chosen primary, else the first.
 *
 * @param {{images?: object[]}} product
 * @returns {object|null} the gallery entry, or null when there are no images
 */
export const primaryImage = (product) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  if (images.length === 0) return null;
  return images.find((img) => img?.isPrimary) || images[0] || null;
};

/**
 * The image representing `variant` within `product`.
 *
 * @param {{images?: object[]}} product
 * @param {{imageKey?: string}|null} [variant] - null/undefined resolves the product itself
 * @returns {object|null} a gallery entry, or null when the product has no images
 */
export const resolveVariantImage = (product, variant = null) => {
  const key = typeof variant?.imageKey === 'string' ? variant.imageKey.trim() : '';
  if (key) {
    const images = Array.isArray(product?.images) ? product.images : [];
    const match = images.find((img) => imageKey(img) === key);
    if (match) return match;
  }
  return primaryImage(product);
};

/**
 * Convenience: just the URL, for the many callers that only render one.
 *
 * @returns {string|null}
 */
export const resolveVariantImageUrl = (product, variant = null) =>
  resolveVariantImage(product, variant)?.url || null;

/**
 * The set of gallery keys currently pointed at by any of this product's models.
 * Used by the write path to drop pointers whose target has been removed.
 *
 * @param {{variants?: object[]}} product
 * @returns {Set<string>}
 */
export const referencedImageKeys = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return new Set(
    variants
      .map((v) => (typeof v?.imageKey === 'string' ? v.imageKey.trim() : ''))
      .filter(Boolean)
  );
};

/**
 * Clear model pointers whose target is not in `images`.
 *
 * Called by the write path AFTER the final gallery is composed, so a save that
 * removes a gallery image also drops every pointer to it in the same operation.
 * Reads already fall back safely (see the header), so this is hygiene rather
 * than a correctness fix — but leaving dead keys in the document would make
 * "is this asset still referenced?" unanswerable later, which is precisely the
 * question cleanup has to get right.
 *
 * Pure: returns new plain objects, never mutates the input. Callers pass either
 * plain payload objects or lean documents, never live Mongoose subdocuments.
 *
 * @param {object[]} images   - the composed, final gallery
 * @param {object[]} variants - the composed, final variants
 * @returns {object[]} variants with unresolvable `imageKey`s removed
 */
export const pruneDanglingPointers = (images, variants) => {
  const list = Array.isArray(variants) ? variants : [];
  const live = new Set(
    (Array.isArray(images) ? images : []).map(imageKey).filter(Boolean)
  );
  return list.map((v) => {
    const key = typeof v?.imageKey === 'string' ? v.imageKey.trim() : '';
    if (!key) return v;
    if (live.has(key)) return v;
    const { imageKey: _dropped, ...rest } = v;
    return rest;
  });
};

/**
 * Decide which gallery images have outlived the models they were uploaded for.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A gallery image marked `variantOwned` exists only to depict a model. Once no
 * surviving model points at it, no page can reach it and nothing will ever
 * render it again — so it is removed from the gallery and its asset deleted.
 * Images the admin added as ordinary product photos are NEVER touched, however
 * many models come and go.
 *
 * ── Why an invariant, not an event handler ──────────────────────────────────
 * The obvious implementation is "when a model is deleted, delete its image".
 * That is a handler, and handlers have to be attached to every path that can
 * orphan an image — the model row being removed, the model being re-pointed at
 * a different photo, the product being switched from variable back to simple
 * (which wipes every model at once), a bulk edit, a re-import. Miss one and the
 * asset leaks silently, which is the failure this project has already paid for
 * twice.
 *
 * Recomputing "is anything still pointing at this?" on every write covers all
 * of those paths with one rule, and cannot be bypassed by a path nobody thought
 * of. It is also self-correcting: a leak from an older code path is cleaned up
 * the next time that product is saved.
 *
 * ── Two safety valves ───────────────────────────────────────────────────────
 *  1. SHARED REFERENCES. An image several models point at survives until the
 *     LAST of them is gone. Deleting one model must never blank its siblings.
 *  2. ADOPTION. If the admin has promoted a model photo to be the product's
 *     primary image, they have deliberately made it a product photo. It is kept
 *     and its `variantOwned` flag is cleared, so it becomes an ordinary gallery
 *     image and is never reconsidered. Without this, removing a model could
 *     silently delete the product's main photograph.
 *
 * Pure: returns new plain objects and never mutates the input, so a caller can
 * decide from the plan and only then touch Mongo or storage.
 *
 * @param {object[]} images   - the composed, final gallery
 * @param {object[]} variants - the composed, final variants
 * @returns {{survivors: object[], orphaned: object[], changed: boolean}}
 *          `orphaned` carries full {url, public_id} refs — the url is what says
 *          WHICH store holds the asset, so never reduce these to bare ids.
 */
export const planVariantOwnedCleanup = (images, variants) => {
  const gallery = Array.isArray(images) ? images : [];
  const referenced = referencedImageKeys({ variants });

  const survivors = [];
  const orphaned = [];

  for (const img of gallery) {
    if (!img?.variantOwned || referenced.has(imageKey(img))) {
      survivors.push(img);
      continue;
    }
    if (img.isPrimary) {
      // Adopted — the admin made this the product's face. Demote the flag so it
      // is treated as an ordinary gallery photo from here on.
      survivors.push({ ...img, variantOwned: false });
      continue;
    }
    orphaned.push(img);
  }

  return { survivors, orphaned, changed: orphaned.length > 0 };
};

export default resolveVariantImage;
