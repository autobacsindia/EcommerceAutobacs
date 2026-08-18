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
 * SCALING MODEL: one image, shown whole, scaled to the viewport. The strip keeps
 * the artwork's own aspect ratio at every width — nothing is cropped, so no part
 * of the campaign message can be cut off on a narrow screen. The trade is that a
 * very wide banner gets short on a phone (a 16:1 strip is ~23px tall at 375px),
 * which is legible for a bold headline and not much else. If a campaign needs
 * more presence on mobile than that allows, the answer is a second, taller crop
 * served through a <picture> source — a deliberate follow-up, not a default.
 *
 * Purely promotional: it links, it never transacts. Nothing here reads or shows
 * a price, a total, or stock.
 */

/** srcset widths — a full-bleed strip, so these track viewport widths. */
const WIDTHS = [640, 828, 1080, 1440, 1920] as const;

/**
 * Ratio used when a banner has no stored dimensions (seeded by hand, or saved
 * before the fields existed). Matches the house artwork spec, so the reserved
 * box is close enough that any correction is imperceptible.
 */
const FALLBACK_ASPECT = '1600 / 100';

/**
 * Build a Cloudinary srcset through the project's next/image loader, so this
 * strip gets exactly the same f_auto/q_auto/c_limit delivery treatment as every
 * other image on the site (never the stored original).
 */
const srcSetFor = (url: string) =>
  WIDTHS.map((w) => `${cloudinaryLoader({ src: url, width: w })} ${w}w`).join(', ');

export default function PromoBanner({ banner }: { banner: PromoBannerData | null }) {
  if (!banner) return null;

  const { imageUrl, imageWidth, imageHeight, alt, linkPath } = banner;

  /**
   * Reserve the exact space the image will occupy, before it loads.
   *
   * `aspect-ratio` on the wrapper is what makes proportional scaling safe: the
   * browser computes the height from the width at first layout, so the strip is
   * full-size in the very first frame and the page below never jumps. Height
   * alone (`h-auto` on the image) would leave the box at 0 until the bytes
   * arrive — a full-width shift at the top of the document, on every page.
   */
  const aspectRatio =
    imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : FALLBACK_ASPECT;

  return (
    <Link
      href={linkPath}
      aria-label={alt}
      className="group block w-full overflow-hidden bg-obsidian"
      style={{ aspectRatio }}
    >
      {/*
        A plain <img>, not next/image: the wrapper above already owns sizing, and
        `fill` would need a positioned parent for no gain here. Delivery is
        unchanged — both the src and every srcSet entry go through
        cloudinaryLoader, the same f_auto/q_auto/c_limit pipeline next/image
        would have applied, so this is never the raw upload.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- sized by the aspect-ratio wrapper; still Cloudinary-optimised */}
      <img
        src={cloudinaryLoader({ src: imageUrl, width: 1920 })}
        srcSet={srcSetFor(imageUrl)}
        sizes="100vw"
        alt={alt}
        width={imageWidth ?? undefined}
        height={imageHeight ?? undefined}
        /**
         * Above the fold on every page, so it must not be lazy — a lazily loaded
         * top-of-page image is a guaranteed late paint. `fetchPriority` stays
         * default rather than "high": on the home page the hero is the LCP
         * element and this strip must not compete with it for bandwidth.
         */
        loading="eager"
        decoding="async"
        className="block h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.01]"
      />
    </Link>
  );
}
