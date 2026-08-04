'use client';

import { Expand } from 'lucide-react';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { MAIN_IMAGE_SIZES, type GalleryImage } from './types';
import { useSnapPager } from './useSnapPager';

/** Above this many images the dot row stops being scannable; the counter carries it. */
const MAX_DOTS = 8;

interface GalleryCarouselProps {
  images: GalleryImage[];
  name: string;
  active: number;
  onActiveChange: (index: number) => void;
  onOpen: (index: number) => void;
  onSale?: boolean;
  className?: string;
}

/**
 * Touch gallery for phone and tablet — a native scroll-snap strip.
 *
 * Replaces the desktop magnifier below `lg`, where hover does not exist. Swipe
 * to page, tap to open the fullscreen viewer (which is where pinch-zoom lives).
 *
 * No thumbnail rail is rendered here: the rail is a sibling shown from `sm` up,
 * so phones keep their vertical space for the buy box. On a phone PDP, every
 * 80 px spent above the fold is 80 px of Add to Cart pushed below it.
 */
export default function GalleryCarousel({
  images,
  name,
  active,
  onActiveChange,
  onOpen,
  onSale,
  className,
}: GalleryCarouselProps) {
  const reduceMotion = usePrefersReducedMotion();
  const { scrollerRef } = useSnapPager({
    count: images.length,
    active,
    onActiveChange,
    smooth: !reduceMotion,
  });

  return (
    <div className={className} data-testid="gallery-carousel">
      {/* Overlays anchor to the IMAGE, not to the whole component: with the dot
          row inside the positioning context, `bottom-4` would land on the dots
          instead of on the photo. */}
      <div className="relative">
        <div
          ref={scrollerRef}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${name} images`}
          className={cn(
            'flex snap-x snap-mandatory overflow-x-auto',
            // Keeps an over-swipe at the first/last image from reaching the
            // browser's own horizontal gesture — on iOS Safari that gesture is
            // "go back", and losing the PDP mid-swipe is unrecoverable.
            'overscroll-x-contain',
            // The strip is self-describing via dots and counter; a scrollbar
            // under a product photo is just chrome.
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
        >
          {images.map((image, index) => (
            <button
              // Keyed by POSITION, not by URL: `useSnapPager` observes the slide
              // nodes present when the count last changed, so a same-length list
              // with different URLs must reuse these nodes rather than replace
              // them. Safe here because a slide holds no state of its own — only
              // the image src, which React updates in place.
              key={index}
              type="button"
              onClick={() => onOpen(index)}
              aria-label={`Open ${image.alt} in fullscreen`}
              className="relative aspect-square w-full shrink-0 snap-center border border-hairline bg-obsidian-raised"
            >
              <EnhancedImage
                src={image.src}
                alt={image.alt}
                fill
                sizes={MAIN_IMAGE_SIZES}
                // Only the first slide is an LCP candidate. The rest stay lazy
                // so a five-image product does not open five connections at
                // once on a phone.
                priority={index === 0}
                context="product"
                className="h-full w-full object-contain"
              />
            </button>
          ))}
        </div>

        {onSale && (
          <div className="pointer-events-none absolute left-4 top-4 grid h-14 w-14 place-items-center rounded-full bg-gold text-[9px] font-semibold uppercase tracking-[0.16em] text-obsidian">
            Sale
          </div>
        )}

        {images.length > 1 && (
          <div className="pointer-events-none absolute right-4 top-4 border border-hairline bg-obsidian/80 px-2.5 py-1 text-[10px] tracking-[0.16em] text-ink-muted backdrop-blur-sm">
            {active + 1} / {images.length}
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 border border-hairline bg-obsidian/80 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-muted backdrop-blur-sm"
        >
          <Expand className="h-3 w-3" />
          Tap to zoom
        </div>
      </div>

      {images.length > 1 && images.length <= MAX_DOTS && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {images.map((image, index) => (
            <button
              key={`dot-${image.src}-${index}`}
              type="button"
              onClick={() => onActiveChange(index)}
              aria-label={`Go to image ${index + 1} of ${images.length}`}
              aria-current={index === active}
              className="grid h-6 w-6 place-items-center"
            >
              {/* 24px hit area (the touch-target floor) around a small visible
                  dot, so the row stays quiet under the photo. */}
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all duration-200',
                  index === active ? 'w-5 bg-gold' : 'w-1.5 bg-ink-muted'
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
