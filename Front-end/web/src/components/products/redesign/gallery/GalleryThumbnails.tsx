'use client';

import { useEffect, useRef } from 'react';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import type { GalleryImage } from './types';

interface GalleryThumbnailsProps {
  images: GalleryImage[];
  active: number;
  onSelect: (index: number) => void;
  className?: string;
}

/**
 * Thumbnail rail.
 *
 * Renders EVERY image. The previous gallery hard-capped this at
 * `images.slice(0, 5)`, so a product photographed from eight angles silently
 * published five and made the other three unreachable — merchandising had no way
 * to know their uploads were being dropped. Five still fit the row exactly; the
 * remainder scroll.
 */
export default function GalleryThumbnails({
  images,
  active,
  onSelect,
  className,
}: GalleryThumbnailsProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const isFirstRun = useRef(true);
  const reduceMotion = usePrefersReducedMotion();

  // Keep the selected thumbnail in view — on mount as well as on every later
  // change. Mount matters: the viewer renders its own copy of this rail and can
  // open at image 8 of 10, which would otherwise show thumbnails 1–5 with no
  // visible selection until the customer navigated once.
  //
  // Deliberately NOT `scrollIntoView`. That walks every scrollable ancestor, so
  // running it on mount would scroll the PAGE down to reach the rail, hijacking
  // the landing position of any PDP whose gallery sits below the fold. Scrolling
  // the rail itself can only ever move the rail, which is what makes it safe to
  // run unconditionally.
  useEffect(() => {
    // Read and clear before any early return, so a first run that happens to
    // need no scrolling still counts as having happened.
    const instant = isFirstRun.current || reduceMotion;
    isFirstRun.current = false;

    const rail = railRef.current;
    const target = rail?.children[active] as HTMLElement | undefined;
    if (!rail || !target || typeof rail.scrollTo !== 'function') return;

    // Centre the active thumbnail, clamped to the ends so the first and last
    // do not leave a gap.
    const centred = target.offsetLeft - (rail.clientWidth - target.clientWidth) / 2;
    const left = Math.max(0, Math.min(centred, rail.scrollWidth - rail.clientWidth));
    if (Math.abs(rail.scrollLeft - left) < 2) return;

    rail.scrollTo({ left, behavior: instant ? 'auto' : 'smooth' });
  }, [active, reduceMotion]);

  return (
    <div
      ref={railRef}
      className={cn(
        'gap-3 overflow-x-auto pb-1',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`Show image ${index + 1} of ${images.length}`}
          aria-current={index === active}
          className={cn(
            'relative aspect-square shrink-0 overflow-hidden border bg-obsidian-raised transition-colors',
            // Exactly five across the rail: full width less the four 0.75rem gaps.
            'w-[calc((100%-3rem)/5)] min-w-[56px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian',
            index === active ? 'border-gold' : 'border-hairline hover:border-gold/50'
          )}
        >
          <EnhancedImage
            src={image.src}
            alt=""
            fill
            // The rail is at most ~120 CSS px wide per cell; 15vw covers it at
            // 3x DPR without pulling a full-size product shot per thumbnail.
            sizes="(max-width: 1023px) 20vw, 120px"
            context="product"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}
