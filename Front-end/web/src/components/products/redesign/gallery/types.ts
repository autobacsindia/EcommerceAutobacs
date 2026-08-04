/**
 * Shared contract + tuning constants for the PDP gallery.
 *
 * Kept in one module so the desktop magnifier, the touch carousel and the
 * fullscreen lightbox agree on image dimensions — three components requesting
 * three different Cloudinary widths for the same photo would triple the derived
 * assets and wreck the CDN hit rate.
 */

export interface GalleryImage {
  src: string;
  alt: string;
}

/**
 * `sizes` for the main product image, shared by the touch carousel and the
 * desktop magnifier base layer.
 *
 * Both render the same URL, so an identical `sizes` means both resolve to the
 * same srcset candidate — one network fetch, and `priority` on the first image
 * emits one deduplicated preload instead of two competing ones.
 *
 * 640px is the desktop frame rounded up: the PDP grid is `max-w-[1340px]` less
 * `px-8` less a `gap-16` column gap, halved ≈ 606 CSS px.
 */
export const MAIN_IMAGE_SIZES = '(max-width: 1023px) 100vw, 640px';

/**
 * Cloudinary width requested for the magnified / fullscreen source.
 *
 * A single fixed rung on purpose. A width derived from the viewport would
 * scatter requests across dozens of widths, each a separate Cloudinary
 * derivation and a separate CDN object; one rung means the second visitor to a
 * product hits a warm edge cache.
 *
 * `c_limit` in `lib/cloudinaryLoader.ts` never upscales, so this is a ceiling,
 * not a promise — see ZOOM_FACTOR for why that ceiling is the binding
 * constraint here.
 */
export const ZOOM_SOURCE_WIDTH = 1600;

/**
 * Magnification for the desktop hover zoom.
 *
 * 2× is a resolution decision, not a taste one. Product originals in this
 * catalogue are 1080–1254 px square (sampled from prod via Cloudinary
 * `fl_getinfo`), and the desktop frame is ~606 CSS px, so 2× consumes ~1212 px
 * of source — essentially all of it. Raising this to 3× would not reveal more
 * detail; it would interpolate pixels that were never captured and render
 * visibly softer than no zoom at all, on the one page where image fidelity is
 * the product.
 *
 * Deeper zoom is an asset-pipeline change (re-upload at 2000 px+), not a
 * frontend one. Do not raise this without raising the source resolution first.
 */
export const ZOOM_FACTOR = 2;
