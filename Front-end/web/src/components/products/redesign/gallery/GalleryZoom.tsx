'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import EnhancedImage from '@/components/layout/EnhancedImage';
import cloudinaryLoader from '@/lib/cloudinaryLoader';
import { useCanHover, usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { MAIN_IMAGE_SIZES, ZOOM_FACTOR, ZOOM_SOURCE_WIDTH, type GalleryImage } from './types';

interface GalleryZoomProps {
  image: GalleryImage;
  /** Marks the PDP's LCP element. Only ever true for the first image. */
  priority?: boolean;
  onSale?: boolean;
  /** Click / Enter / Space — the keyboard- and touch-reachable equivalent. */
  onOpen: () => void;
}

/**
 * Desktop main image with a cursor-tracking magnifier.
 *
 * Interaction model — the image scales inside its own frame rather than
 * projecting into an adjacent panel. The PDP is a two-column grid with the
 * BuyBox immediately to the right, so an Amazon-style result panel would cover
 * the price and Add to Cart: the highest-value pixels on the page, hidden by a
 * browsing affordance. Magnifying in place costs no layout and covers nothing.
 *
 * Three things here are load-bearing for production and easy to lose in a
 * refactor:
 *
 *   1. Pointer tracking never calls `setState`. A state update per pointermove
 *      is 120 re-renders a second on a page already running framer-motion
 *      reveals; we write `transformOrigin` straight to the node inside a single
 *      in-flight rAF, so bursts coalesce to one style write per frame. React
 *      state tracks only the hover boolean.
 *
 *   2. The sharp source is fetched on intent, not on load. A visitor who never
 *      hovers pays nothing; one who does gets the high-resolution layer
 *      cross-faded in, so the first zoom is never a blur-then-snap.
 *
 *   3. Both layers live in ONE transformed wrapper. The already-decoded base
 *      image scales instantly for immediate feedback and the sharp layer fades
 *      over it when it arrives — and there is only ever one element whose
 *      transform-origin must track the cursor.
 */
export default function GalleryZoom({ image, priority, onSale, onOpen }: GalleryZoomProps) {
  const canHover = useCanHover();
  const reduceMotion = usePrefersReducedMotion();

  const frameRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const [zooming, setZooming] = useState(false);
  /** Sticky: once the user has hovered, keep requesting sharp sources. */
  const [hasIntent, setHasIntent] = useState(false);
  /** The sharp source that has finished decoding — compared against the current
   *  one so switching images never flashes the previous photo's zoom layer. */
  const [decodedSrc, setDecodedSrc] = useState<string | null>(null);

  const zoomSrc = cloudinaryLoader({ src: image.src, width: ZOOM_SOURCE_WIDTH });
  const sharpReady = decodedSrc === zoomSrc;

  const writeOrigin = useCallback(() => {
    rafRef.current = null;
    const point = pendingRef.current;
    const layer = layerRef.current;
    if (!point || !layer) return;
    layer.style.transformOrigin = `${point.x * 100}% ${point.y * 100}%`;
  }, []);

  const trackPointer = useCallback(
    (clientX: number, clientY: number, immediate = false) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Clamped so a pointer leaving the frame mid-frame can never push the
      // origin outside the image and expose an empty edge.
      pendingRef.current = {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };

      // On enter we must land on the right origin in the same frame the scale
      // is applied, otherwise the image visibly swings from the previous origin.
      if (immediate) {
        writeOrigin();
        return;
      }
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(writeOrigin);
      }
    },
    [writeOrigin]
  );

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // A pointing device can be unplugged, or the frame can scroll away mid-hover;
  // either way the zoomed state must not survive.
  useEffect(() => {
    if (!canHover) setZooming(false);
  }, [canHover]);

  const engage = (event: React.PointerEvent<HTMLButtonElement>) => {
    setHasIntent(true);
    trackPointer(event.clientX, event.clientY, true);
    setZooming(true);
  };

  const handleEnter = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canHover) return;
    engage(event);
  };

  const handleMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canHover) return;
    // A move without a preceding enter means the enter was swallowed — most
    // commonly the fullscreen viewer opening over the frame and closing again
    // with the cursor never having left it. Re-engage instead of sitting dead
    // until the customer moves the mouse off the image and back.
    if (!zooming) {
      engage(event);
      return;
    }
    trackPointer(event.clientX, event.clientY);
  };

  const handleLeave = () => setZooming(false);

  return (
    <button
      ref={frameRef}
      type="button"
      onPointerEnter={handleEnter}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
      onClick={onOpen}
      aria-label={`Open ${image.alt} in fullscreen`}
      data-testid="gallery-zoom"
      className={cn(
        'relative block aspect-square w-full overflow-hidden border border-hairline bg-obsidian-raised',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian',
        canHover ? 'cursor-zoom-in' : 'cursor-pointer'
      )}
    >
      <div
        ref={layerRef}
        className={cn('absolute inset-0', !reduceMotion && 'transition-transform duration-200 ease-out')}
        style={{
          transform: zooming ? `scale(${ZOOM_FACTOR})` : undefined,
          // Promote only while it can actually change — a permanent
          // `will-change` keeps a compositor layer alive for every PDP visit.
          willChange: zooming ? 'transform' : undefined,
        }}
      >
        <EnhancedImage
          src={image.src}
          alt={image.alt}
          fill
          sizes={MAIN_IMAGE_SIZES}
          priority={priority}
          context="product"
          className="h-full w-full object-contain"
        />

        {/*
          Deliberately a plain <img>, not next/image: this layer needs ONE exact
          URL at the source ceiling, decided by us. next/image would pick from a
          srcset by rendered box size — which is the unzoomed frame, i.e. exactly
          the resolution that makes a magnifier pointless.
        */}
        {hasIntent && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={zoomSrc}
            src={zoomSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
            onLoad={() => setDecodedSrc(zoomSrc)}
            className={cn(
              'pointer-events-none absolute inset-0 h-full w-full object-contain',
              !reduceMotion && 'transition-opacity duration-200',
              zooming && sharpReady ? 'opacity-100' : 'opacity-0'
            )}
          />
        )}
      </div>

      {onSale && (
        <div className="pointer-events-none absolute left-5 top-5 grid h-16 w-16 place-items-center rounded-full bg-gold text-[10px] font-semibold uppercase tracking-[0.16em] text-obsidian">
          Sale
        </div>
      )}

      {canHover && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 border border-hairline bg-obsidian/80 px-3 py-1.5',
            'text-[10px] uppercase tracking-[0.16em] text-ink-muted backdrop-blur-sm',
            !reduceMotion && 'transition-opacity duration-200',
            zooming ? 'opacity-0' : 'opacity-100'
          )}
        >
          <ZoomIn className="h-3 w-3" />
          Hover to zoom
        </div>
      )}
    </button>
  );
}
