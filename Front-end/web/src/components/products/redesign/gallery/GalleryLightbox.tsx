'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import cloudinaryLoader from '@/lib/cloudinaryLoader';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { ZOOM_SOURCE_WIDTH, type GalleryImage } from './types';
import GalleryThumbnails from './GalleryThumbnails';
import { useSnapPager } from './useSnapPager';

interface GalleryLightboxProps {
  images: GalleryImage[];
  name: string;
  /** `null` closes the viewer; a number opens it at that index. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Fullscreen image viewer, shared by every breakpoint.
 *
 * Built on the native `<dialog>` + `showModal()` rather than a portal-and-z-index
 * overlay. That buys, for free and correctly: focus trapping, focus restoration
 * to the trigger on close, Escape handling, `inert` background content for
 * screen readers, and top-layer stacking that cannot lose a z-index race with a
 * sticky header or a payment iframe. Every one of those is a bug we would
 * otherwise ship, discover in production, and patch one at a time.
 *
 * Zoom inside the viewer is the browser's own pinch gesture (`touch-action:
 * pinch-zoom`), not hand-rolled touch math. Two-finger pinch, double-tap, and
 * inertial pan then behave exactly as they do everywhere else on the device.
 * The page's viewport meta permits user scaling, so this works as written — do
 * not add `maximum-scale`/`user-scalable=no` to `app/layout.tsx` without
 * knowingly breaking it (and the WCAG 1.4.4 conformance that goes with it).
 */
export default function GalleryLightbox({
  images,
  name,
  index,
  onIndexChange,
  onClose,
}: GalleryLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const open = index !== null;

  // Content mounts only AFTER the dialog is actually open.
  //
  // Not an optimisation — a correctness requirement. React runs child effects
  // before parent effects, so content mounted in the same commit would measure
  // itself while the dialog was still `display: none`, every slide offset would
  // read 0, and a viewer opened from the fourth thumbnail would land on the
  // first image. Deferring by one commit means the strip positions itself
  // against real layout, before paint. It also keeps full-size images out of
  // the DOM entirely until someone opens the viewer.
  const [contentMounted, setContentMounted] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open) {
      if (!el.open) {
        // `showModal` throws if the dialog is already open, and is absent both
        // in jsdom (see the polyfill in jest.setup.js) and on browsers older
        // than the <dialog> API — Safari < 15.4, i.e. the same locked-iOS tier
        // `useMediaQuery` still caters for. There, fall back to opening it
        // non-modally: the element is positioned and sized by our own classes,
        // so it still fills the screen and is still usable. What degrades is
        // the free stuff — focus trapping, the top layer, ::backdrop — none of
        // which is worth a second overlay implementation to recover.
        if (typeof el.showModal === 'function') el.showModal();
        else el.open = true;
      }
      setContentMounted(true);
    } else {
      if (el.open) {
        if (typeof el.close === 'function') el.close();
        else el.open = false;
      }
      setContentMounted(false);
    }
  }, [open]);

  // `showModal` makes the background inert but does NOT stop it scrolling; on
  // touch devices the page visibly slides behind the viewer without this.
  // Keyed off the dialog actually being open, never off intent — locking the
  // page while nothing is on screen would strand the customer.
  useEffect(() => {
    if (!contentMounted || !dialogRef.current?.open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [contentMounted]);

  const count = images.length;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (index === null) return;

    // Escape is handled natively by a modal dialog (cancel → close → onClose),
    // but the non-modal fallback above has no such behaviour. Closing here too
    // costs nothing — `onClose` only clears state, so the duplicate call on the
    // native path is a no-op.
    if (event.key === 'Escape') {
      onClose();
      return;
    }

    if (count < 2) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onIndexChange((index + 1) % count);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onIndexChange((index - 1 + count) % count);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      // Fires for Escape and for `.close()` alike on a browser with the dialog
      // API. `handleKeyDown` covers Escape for the non-modal fallback, where no
      // such event exists; both routes converge on the same `onClose`.
      onClose={onClose}
      onKeyDown={handleKeyDown}
      aria-label={`${name} image viewer`}
      className={cn(
        // Hiding a closed dialog is normally the UA stylesheet's job. We assert
        // it ourselves because a browser that does not implement <dialog> has no
        // such rule, and these classes would then paint an opaque, full-screen,
        // permanently-open panel over the entire PDP. Keyed off the `open`
        // attribute rather than React state, so it stays correct through the
        // frame between a native close and the re-render that follows it.
        '[&:not([open])]:hidden',
        'fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden',
        'border-0 bg-obsidian p-0 font-display text-ink',
        'backdrop:bg-black/90 backdrop:backdrop-blur-sm'
      )}
    >
      {contentMounted && index !== null && (
        <LightboxContent
          images={images}
          index={index}
          onIndexChange={onIndexChange}
          onClose={onClose}
        />
      )}
    </dialog>
  );
}

interface LightboxContentProps {
  images: GalleryImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function LightboxContent({ images, index, onIndexChange, onClose }: LightboxContentProps) {
  const reduceMotion = usePrefersReducedMotion();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const count = images.length;
  const { scrollerRef } = useSnapPager({
    count,
    active: index,
    onActiveChange: onIndexChange,
    smooth: !reduceMotion,
  });

  // `showModal()` autofocuses the first focusable descendant — but it runs one
  // commit before this content exists (see the parent), so it finds an empty
  // dialog and parks focus on the dialog element itself. Verified in a real
  // browser, invisible in jsdom. Claim focus explicitly now that the controls
  // are mounted, so the first Tab lands somewhere predictable and a screen
  // reader announces the control rather than a bare container.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const go = (delta: number) => onIndexChange(((index + delta) % count + count) % count);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3 sm:px-6">
        <span className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          {index + 1} / {count}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="grid h-10 w-10 place-items-center border border-hairline text-ink transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          className={cn(
            'flex h-full snap-x snap-mandatory overflow-x-auto overscroll-contain',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
        >
          {images.map((image, slideIndex) => (
            <div
              // Keyed by position — see the note in GalleryCarousel; the slide
              // observer requires these nodes to survive a same-length list swap.
              key={slideIndex}
              className="flex h-full w-full shrink-0 snap-center items-center justify-center p-4 sm:p-8"
              // `pan-x` keeps the swipe-to-page gesture; `pinch-zoom` hands the
              // two-finger gesture to the browser. Vertical panning is
              // deliberately excluded — the viewer does not scroll, and allowing
              // it would let a sloppy swipe drag the page behind the dialog.
              style={{ touchAction: 'pan-x pinch-zoom' }}
              // Clicking the letterboxed margin closes, matching the muscle
              // memory of every other lightbox; clicks on the photo itself do
              // not, so a mis-aimed pinch cannot dismiss the viewer.
              onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
              }}
            >
              {/*
                Windowed to the current slide and its neighbours. These are
                full-resolution sources; mounting all of them would fire N
                simultaneous requests on a phone, and the ones off-screen would
                compete with the one the user is waiting for.
              */}
              {Math.abs(slideIndex - index) <= 1 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryLoader({ src: image.src, width: ZOOM_SOURCE_WIDTH })}
                  alt={image.alt}
                  draggable={false}
                  fetchPriority={slideIndex === index ? 'high' : 'auto'}
                  className="max-h-full max-w-full object-contain"
                />
              )}
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            <LightboxArrow direction="prev" onClick={() => go(-1)} />
            <LightboxArrow direction="next" onClick={() => go(1)} />
          </>
        )}
      </div>

      {count > 1 && (
        <div className="shrink-0 border-t border-hairline px-4 py-3 sm:px-6">
          <GalleryThumbnails
            images={images}
            active={index}
            onSelect={onIndexChange}
            className="mx-auto flex max-w-md"
          />
        </div>
      )}
    </div>
  );
}

function LightboxArrow({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const isPrev = direction === 'prev';
  const Icon = isPrev ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? 'Previous image' : 'Next image'}
      className={cn(
        // Hidden on phones, where the swipe gesture is the primary control and
        // a floating arrow would sit on top of the photo it is meant to reveal.
        'absolute top-1/2 hidden -translate-y-1/2 place-items-center sm:grid',
        'h-12 w-12 border border-hairline bg-obsidian/80 text-ink backdrop-blur-sm transition-colors',
        'hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
        isPrev ? 'left-4' : 'right-4'
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}
