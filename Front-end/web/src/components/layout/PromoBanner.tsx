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
 * SIZING MODEL: a FIXED height per breakpoint, filling the width, with three
 * separately-designed images. The earlier model — one image scaled to its own
 * aspect ratio — failed at both ends: stretched across a desktop window it was
 * blurry unless the source was enormous, and squeezed onto a phone an ~18:1
 * strip collapsed to a ~23px sliver nobody could read. One picture cannot serve
 * a 375px phone and a 2560px monitor; three can.
 *
 * Because the height is fixed and the width varies, the sides (or, on very wide
 * monitors, the top and bottom) are trimmed. That is deliberate and is why the
 * designer spec defines a centre safe area — see the admin screen, which states
 * the required size next to each upload slot.
 *
 * Purely promotional: it links, it never transacts. Nothing here reads or shows
 * a price, a total, or stock.
 */

/**
 * Rendered height per breakpoint, in CSS pixels. Exported because the home page
 * has to subtract them: its nav is `position: fixed` with no spacer, so the
 * strip needs an explicit offset to sit below it rather than underneath it.
 *
 * MUST stay in step with the artwork sizes quoted in the admin upload screen —
 * the files are designed to these heights at 2× density.
 */
export const PROMO_HEIGHTS = { mobile: 72, tablet: 88, desktop: 104 } as const;

/** Tailwind classes for the heights above. Breakpoints: <640 / 640-1023 / ≥1024. */
const HEIGHT_CLASSES = 'h-[72px] sm:h-[88px] lg:h-[104px]';

/** Artwork narrower than this cannot fill a large 2× display without softening. */
export const RECOMMENDED_MIN_WIDTH = 2560;

/**
 * Required artwork size per slot, at 2× density. Single source of truth for the
 * admin's guidance and its wrong-size warnings.
 */
export const PROMO_SLOT_SPECS = {
  desktop: { label: 'Desktop', width: 3840, height: 208, minViewport: '1024px and up' },
  tablet: { label: 'Tablet', width: 2048, height: 176, minViewport: '640 – 1023px' },
  mobile: { label: 'Mobile', width: 1280, height: 144, minViewport: 'under 640px' },
} as const;

/**
 * srcset widths — a full-bleed strip, so these track DEVICE pixels, not CSS px.
 * A 1920px window on a 2× display needs a 3840px rendition; a srcset stopping at
 * 1920 leaves the browser upscaling, which is what "blurry" looks like.
 * Cloudinary's `c_limit` never upscales past the source, so these are a ceiling,
 * not a promise — sharpness still requires artwork at least this wide.
 */
const WIDTHS = [640, 828, 1080, 1440, 1920, 2560, 3840] as const;

const srcSetFor = (url: string) =>
  WIDTHS.map((w) => `${cloudinaryLoader({ src: url, width: w })} ${w}w`).join(', ');

export default function PromoBanner({ banner }: { banner: PromoBannerData | null }) {
  if (!banner) return null;

  const { imageUrl, tabletImageUrl, mobileImageUrl, alt, linkPath } = banner;

  return (
    <Link
      href={linkPath}
      aria-label={alt}
      className={`group block w-full overflow-hidden bg-obsidian ${HEIGHT_CLASSES}`}
    >
      {/*
        <picture> with media queries, not next/image: this is ART DIRECTION —
        three separately composed images, not three sizes of one. next/image
        cannot express that, and the usual workaround (stacked <Image>s toggled
        with `hidden`) leaves them all in the DOM, so a phone downloads the
        3840px desktop file it will never show.

        Source order is most-specific-first: the browser takes the FIRST matching
        <source>, so desktop must precede tablet. The bare <img> is the mobile
        case and the no-JS/legacy fallback.

        Every URL still goes through cloudinaryLoader, so this is the same
        f_auto/q_auto/c_limit pipeline next/image would have applied.
      */}
      <picture>
        <source media="(min-width: 1024px)" srcSet={srcSetFor(imageUrl)} sizes="100vw" />
        <source media="(min-width: 640px)" srcSet={srcSetFor(tabletImageUrl)} sizes="100vw" />
        {/* eslint-disable-next-line @next/next/no-img-element -- art direction; Cloudinary-optimised above */}
        <img
          src={cloudinaryLoader({ src: mobileImageUrl, width: 1280 })}
          srcSet={srcSetFor(mobileImageUrl)}
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
          className="block h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.01]"
        />
      </picture>
    </Link>
  );
}
