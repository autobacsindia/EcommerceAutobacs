/**
 * Which gallery image represents a selectable model — frontend twin of the
 * backend's `utils/variantImage.js`.
 *
 * A model's photo is a POINTER (`variant.imageKey`) into the product's own
 * gallery, holding that entry's key: its `public_id`, or its `url` for migrated
 * rows that never got one. Nothing here fetches or stores an image; it only
 * answers "which of the images we already have belongs to this model".
 *
 * ── Absent is normal, and it is not an error ────────────────────────────────
 * Most models have no photo of their own and never will. That is a permanent,
 * expected state meaning "show the product's main image", so every function here
 * degrades quietly rather than throwing or blanking the gallery. A pointer at an
 * image that has since been removed degrades the same way: the write path prunes
 * such pointers, but a cached document or a concurrent admin edit can still put
 * one in front of a shopper, and a hole in a live product page is a far worse
 * outcome than a gallery that simply does not jump.
 *
 * Keep in step with the backend twin — they encode the same contract from two
 * sides, and a drift shows up as "selecting a model does nothing", which no test
 * on either side alone would catch.
 */

export interface GalleryImageRef {
  url: string;
  public_id?: string;
  alt?: string;
  isPrimary?: boolean;
}

export interface VariantRef {
  _id: string;
  imageKey?: string | null;
}

/** Stable identity of a gallery entry. Mirrors `imageKey()` on the backend. */
export const imageKeyOf = (img: GalleryImageRef | null | undefined): string =>
  img?.public_id || img?.url || '';

/**
 * Index of the image this model points at, or `null` when it has none (or when
 * the pointer no longer resolves).
 *
 * `null` deliberately means "do not move the gallery" rather than "fall back to
 * the primary". A shopper who has swiped to the fitment shot and then picks a
 * size should not be yanked back to the hero image — the fallback belongs to
 * rendering a single thumbnail, not to navigating a gallery the shopper is
 * already driving.
 */
export const variantImageIndex = (
  images: GalleryImageRef[] | undefined,
  variant: VariantRef | null | undefined,
): number | null => {
  const key = typeof variant?.imageKey === 'string' ? variant.imageKey.trim() : '';
  if (!key || !Array.isArray(images) || images.length === 0) return null;
  const index = images.findIndex((img) => imageKeyOf(img) === key);
  return index === -1 ? null : index;
};

/**
 * The single image representing a model, for contexts that show ONE thumbnail
 * (a dropdown row, a cart line) rather than a gallery. Here the fallback DOES
 * apply, because the alternative is an empty box.
 */
export const variantThumbnail = (
  images: GalleryImageRef[] | undefined,
  variant: VariantRef | null | undefined,
): GalleryImageRef | null => {
  const list = Array.isArray(images) ? images : [];
  if (list.length === 0) return null;
  const index = variantImageIndex(list, variant);
  if (index != null) return list[index];
  return list.find((img) => img.isPrimary) ?? list[0] ?? null;
};
