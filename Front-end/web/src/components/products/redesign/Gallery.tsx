'use client';

import { useCallback, useState } from 'react';
import GalleryCarousel from './gallery/GalleryCarousel';
import GalleryLightbox from './gallery/GalleryLightbox';
import GalleryThumbnails from './gallery/GalleryThumbnails';
import GalleryZoom from './gallery/GalleryZoom';
import type { GalleryImage } from './gallery/types';

export type { GalleryImage };

/**
 * PDP gallery (obsidian + gold).
 *
 * Three presentations over one selection state:
 *   - `lg+`  — main image with a cursor-tracking magnifier (`GalleryZoom`).
 *   - `<lg`  — native scroll-snap swipe strip (`GalleryCarousel`).
 *   - any    — fullscreen `<dialog>` viewer with pinch-zoom (`GalleryLightbox`).
 *
 * The breakpoint split is pure CSS (`lg:hidden` / `hidden lg:block`), not a
 * `useMediaQuery` branch. A JS branch renders one tree on the server and a
 * different one on the client — a hydration mismatch, which the frontend
 * CLAUDE.md calls out as this codebase's recurring bug class. Both subtrees are
 * in the DOM and only one is painted; they render identical URLs, so the cost is
 * DOM nodes, not bytes. The hidden strip is inert by construction: a
 * `display: none` scroller never intersects, so its observer cannot fight the
 * visible variant over the shared index (see `useSnapPager`).
 *
 * The main image is `object-contain`, not `object-cover`. A PDP may never crop
 * product geometry to fill a square — a customer deciding on a body kit needs to
 * see its actual proportions. Thumbnails still crop; they are navigation.
 */
export default function Gallery({
  images,
  name,
  onSale,
}: {
  images: GalleryImage[];
  name: string;
  onSale?: boolean;
}) {
  const [active, setActive] = useState(0);
  /** `null` = viewer closed. Also the index the viewer opens at. */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Products can lose an image between renders (a variant switch, an admin
  // edit landing mid-session); clamping here keeps every child indexing a real
  // element instead of each guarding separately.
  const safeActive = images.length ? Math.min(active, images.length - 1) : 0;

  const openLightbox = useCallback((index: number) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  // Navigating inside the viewer moves the page behind it, so closing leaves the
  // customer on the image they were last looking at.
  const selectFromLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setActive(index);
  }, []);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center border border-hairline bg-obsidian-raised text-[11px] uppercase tracking-[0.2em] text-ink-muted">
        No image
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GalleryCarousel
        className="lg:hidden"
        images={images}
        name={name}
        active={safeActive}
        onActiveChange={setActive}
        onOpen={openLightbox}
        onSale={onSale}
      />

      <div className="hidden lg:block">
        <GalleryZoom
          image={images[safeActive]}
          priority={safeActive === 0}
          onSale={onSale}
          onOpen={() => openLightbox(safeActive)}
        />
      </div>

      {images.length > 1 && (
        <GalleryThumbnails
          // Phones navigate by swipe and dots; the rail would cost ~90px of
          // vertical space directly above the buy box, which is the last place
          // on a phone PDP worth spending it. Tablets have the room.
          className="hidden sm:flex"
          images={images}
          active={safeActive}
          onSelect={setActive}
        />
      )}

      <GalleryLightbox
        images={images}
        name={name}
        index={lightboxIndex}
        onIndexChange={selectFromLightbox}
        onClose={closeLightbox}
      />
    </div>
  );
}
