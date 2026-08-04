'use client';

import { useEffect, useRef } from 'react';
import EnhancedImage from '@/components/layout/EnhancedImage';
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

  // Keep the selected thumbnail in view when the index changes from elsewhere
  // (a swipe on the carousel, arrow keys in the lightbox) — otherwise the rail
  // silently disagrees with the main image once past the fifth photo.
  //
  // Skipped on mount: `block: 'nearest'` walks every scrollable ancestor, so on
  // first render — before the customer has done anything — it would scroll the
  // PAGE down to bring the rail into view, hijacking the landing position of
  // every PDP where the gallery sits below the fold.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const target = railRef.current?.children[active] as HTMLElement | undefined;
    if (typeof target?.scrollIntoView !== 'function') return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

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
