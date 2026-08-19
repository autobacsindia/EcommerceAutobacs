import Link from 'next/link';
import cloudinaryLoader from '@/lib/cloudinaryLoader';
import type { PromoBanner as PromoBannerData } from '@/lib/promoBanner';

/**
 * Site-wide occasion strip (Onam, Diwali, seasonal sale).
 *
 * Presentational only — it receives an already-resolved banner and renders it,
 * with no fetching of its own. The read happens on the server (lib/promoBanner
 * getActivePromoBanner, called from the root layout), so the strip is in the
 * initial HTML instead of popping in after hydration and pushing the page down.
 *
 * SIZING MODEL: full width, height derived from the artwork's OWN aspect ratio,
 * nothing cropped. The strip grows and shrinks with the window; the whole image
 * is always on screen.
 *
 * This replaced a fixed-height + `object-cover` model, which had to slice the
 * sides off any artwork whose ratio didn't match the window's — the wider the
 * monitor, the more of the message disappeared. Height is now the dependent
 * variable, which is the only way a full-bleed strip can be both uncropped and
 * responsive.
 *
 * The ratio comes from the pixel dimensions Cloudinary reported at upload and
 * stored on the banner, so the box is reserved at the exact right height before
 * a byte of image arrives — no layout shift, despite the height being fluid.
 * `object-contain` backs it up: if the dimensions are missing (a legacy row) or
 * a clamp below changes the box shape, the artwork letterboxes on the strip's
 * own background rather than losing content. Letterboxing is recoverable;
 * cropping the offer out of the offer banner is not.
 *
 * Purely promotional: it links, it never transacts. Nothing here reads or shows
 * a price, a total, or stock.
 */

/**
 * Artwork guidance per slot. Single source of truth for the admin screen's
 * instructions and its wrong-size warnings.
 *
 * `ratio` is the width÷height the file should be designed to, and it is the
 * number that actually matters now: it alone decides how tall the strip renders.
 * The three chosen ratios all land at roughly 100px tall on a typical device of
 * their class (3840/15 at a 1512px laptop ≈ 101px; 2048/8 at an 800px tablet
 * ≈ 100px; 1280/4 at a 390px phone ≈ 98px), so the strip looks like the same
 * strip everywhere while every file stays whole.
 *
 * `width` is the export width, set so the file still has ~2× device pixels to
 * spend on the largest screen in its band. Cloudinary's `c_limit` never upscales,
 * so a smaller export cannot be rescued at render time.
 */
export const PROMO_SLOT_SPECS = {
  desktop: { label: 'Desktop', width: 3840, height: 256, ratio: 15, minViewport: '1024px and up' },
  tablet: { label: 'Tablet', width: 2048, height: 256, ratio: 8, minViewport: '640 – 1023px' },
  mobile: { label: 'Mobile', width: 1280, height: 320, ratio: 4, minViewport: 'under 640px' },
} as const;

export type PromoSlot = keyof typeof PROMO_SLOT_SPECS;

/**
 * Height clamps, in CSS pixels.
 *
 * MIN — a 15:1 desktop file shown on a 375px phone (because no mobile artwork
 * was uploaded) computes to 25px: unreadable, and below the 44px minimum for a
 * comfortable tap target. The clamp letterboxes it instead.
 *
 * MAX — stops a mis-proportioned upload (someone exports a square poster) from
 * taking over the viewport, and keeps the strip a strip on very wide monitors.
 */
export const PROMO_MIN_HEIGHT = 64;
export const PROMO_MAX_HEIGHT = 200;

/**
 * srcset widths — a full-bleed strip, so these track DEVICE pixels, not CSS px.
 * A 1920px window on a 2× display needs a 3840px rendition; a srcset stopping at
 * 1920 leaves the browser upscaling, which is what "blurry" looks like.
 * Cloudinary's `c_limit` never upscales past the source, so these are a ceiling,
 * not a promise — sharpness still requires artwork at least this wide.
 */
const WIDTHS = [640, 828, 1080, 1440, 1920, 2560, 3840] as const;

const srcSetFor = (url: string | null | undefined) =>
  (url ? WIDTHS.map((w) => `${cloudinaryLoader({ src: url, width: w })} ${w}w`).join(', ') : undefined);

/**
 * The CSS `aspect-ratio` value for a slot: the artwork's true shape when we know
 * it, otherwise the shape the slot was specced for.
 *
 * Exported so the admin preview reserves its box the same way the storefront
 * does — an admin who sees a different shape to a shopper has no way to trust
 * the preview.
 */
export function promoAspectRatio(
  slot: PromoSlot,
  width?: number | null,
  height?: number | null,
): string {
  if (width && height && width > 0 && height > 0) return `${width} / ${height}`;
  return `${PROMO_SLOT_SPECS[slot].ratio} / 1`;
}

/**
 * Resolve one breakpoint's artwork, falling back to the next-widest slot.
 *
 * Tablet and mobile artwork are OPTIONAL — the admin screen ships a banner with
 * only a desktop file and merely warns about it, so every consumer has to cope
 * with a missing slot. Falling back carries the slot's own pixel dimensions with
 * it, so the reserved box matches the file actually being shown; taking the URL
 * without the dimensions would reserve the wrong shape and letterbox a banner
 * that had perfectly good artwork.
 */
type Slot = { url: string | null; width: number | null; height: number | null };

const firstUsable = (...slots: Slot[]): Slot =>
  slots.find((s) => !!s.url) ?? { url: null, width: null, height: null };

export default function PromoBanner({ banner }: { banner: PromoBannerData | null }) {
  if (!banner) return null;

  const {
    imageUrl, imageWidth, imageHeight,
    tabletImageUrl, tabletImageWidth, tabletImageHeight,
    mobileImageUrl, mobileImageWidth, mobileImageHeight,
    alt, linkPath,
  } = banner;

  const desktop = firstUsable({ url: imageUrl, width: imageWidth, height: imageHeight });
  const tablet = firstUsable(
    { url: tabletImageUrl, width: tabletImageWidth, height: tabletImageHeight },
    desktop,
  );
  const mobile = firstUsable(
    { url: mobileImageUrl, width: mobileImageWidth, height: mobileImageHeight },
    tablet,
  );

  // No artwork at all in any slot: render nothing rather than an empty clickable
  // strip. A banner row can legitimately exist with its images not yet uploaded.
  if (!mobile.url) return null;

  /*
    Per-breakpoint ratios ride in as custom properties because their values are
    per-banner data — Tailwind can only emit classes it can see at build time,
    and three media queries cannot be expressed in one inline `style`. The
    classes below are static; only the numbers they read are dynamic.
  */
  const ratioVars = {
    '--promo-ar': promoAspectRatio('mobile', mobile.width, mobile.height),
    '--promo-ar-sm': promoAspectRatio('tablet', tablet.width, tablet.height),
    '--promo-ar-lg': promoAspectRatio('desktop', desktop.width, desktop.height),
  } as React.CSSProperties;

  return (
    <Link
      href={linkPath}
      aria-label={alt}
      style={ratioVars}
      className="group block w-full overflow-hidden bg-obsidian
                 aspect-[var(--promo-ar)] sm:aspect-[var(--promo-ar-sm)] lg:aspect-[var(--promo-ar-lg)]
                 min-h-[64px] max-h-[200px]"
    >
      {/*
        <picture> with media queries, not next/image: this is ART DIRECTION —
        up to three separately composed images, not three sizes of one.
        next/image cannot express that, and the usual workaround (stacked
        <Image>s toggled with `hidden`) leaves them all in the DOM, so a phone
        downloads the 3840px desktop file it will never show.

        Source order is most-specific-first: the browser takes the FIRST matching
        <source>, so desktop must precede tablet. The bare <img> is the mobile
        case and the no-JS/legacy fallback.

        Every URL still goes through cloudinaryLoader, so this is the same
        f_auto/q_auto/c_limit pipeline next/image would have applied.
      */}
      <picture>
        <source media="(min-width: 1024px)" srcSet={srcSetFor(desktop.url)} sizes="100vw" />
        <source media="(min-width: 640px)" srcSet={srcSetFor(tablet.url)} sizes="100vw" />
        {/* eslint-disable-next-line @next/next/no-img-element -- art direction; Cloudinary-optimised above */}
        <img
          src={cloudinaryLoader({ src: mobile.url, width: 1280 })}
          srcSet={srcSetFor(mobile.url)}
          sizes="100vw"
          alt={alt}
          /**
           * Above the fold on every page, so it must not be lazy — a lazily
           * loaded top-of-page image is a guaranteed late paint. `fetchPriority`
           * stays default rather than "high": on the home page the hero is the
           * LCP element and this strip must not compete with it for bandwidth.
           */
          loading="eager"
          decoding="async"
          className="block h-full w-full object-contain object-center transition-transform duration-500 group-hover:scale-[1.01]"
        />
      </picture>
    </Link>
  );
}
