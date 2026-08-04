'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The PDP recommendation rails (Similar Products, Frequently Bought Together).
 *
 * Component and layout constants live in ONE module so the two rails — and their
 * loading skeletons, which render the bare container without arrows — can't
 * drift apart. (A sibling `productRail.ts` would also collide with this file on
 * case-insensitive filesystems.)
 */

/**
 * How many cards each rail requests. Also drives the skeleton count so the
 * placeholder and the loaded rail occupy the same space (no layout shift).
 * The backend clamps this server-side; see RECO_LIMIT_MAX in productController.
 */
export const RAIL_LIMIT = 9;

/**
 * Applies to the container wrapping the cards. A horizontal scroller at EVERY
 * breakpoint — with RAIL_LIMIT cards a desktop grid would be three stacked rows
 * that push the rest of the page down.
 *
 * `motion-reduce:scroll-auto` drops the smooth scroll for users who ask for it;
 * the arrow buttons check the same preference before animating.
 */
export const RAIL_CONTAINER =
  'flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth motion-reduce:scroll-auto ' +
  'overscroll-x-contain sm:gap-6 ' +
  // Bleed past the section's px-4 so the rail runs to the screen edge on phones,
  // then sit inside the container from sm up so the arrows have room at the edges.
  // py-2 is headroom, not decoration: overflow-x also clips vertically, and the
  // cards' hover lift and focus ring both paint outside their box.
  '-mx-4 px-4 py-2 sm:mx-0 sm:px-0 ' +
  // Hide the scrollbar — snap points plus the peeking next card are the affordance.
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * Applies to each card (and each skeleton) inside RAIL_CONTAINER.
 *
 * Widths are deliberately not a clean 1/2/3/4 of the container: leaving the next
 * card partly visible is what tells people the rail scrolls. Roughly 1 / 2 / 2.5
 * / 3 / 4 cards visible as the viewport grows.
 */
export const RAIL_ITEM =
  'shrink-0 snap-start w-[78%] sm:w-[46%] md:w-[38%] lg:w-[30%] xl:w-[23%]';

/** `sizes` for a card image, matching the widths above. */
export const RAIL_IMAGE_SIZES =
  '(max-width: 640px) 78vw, (max-width: 768px) 46vw, (max-width: 1024px) 38vw, (max-width: 1280px) 30vw, 23vw';

interface ProductRailProps {
  /** Names the scroll region for screen readers — e.g. "Similar products". */
  label: string;
  children: ReactNode;
}

/**
 * Horizontal, snapping product rail shared by the PDP recommendation sections.
 *
 * Touch devices swipe. Pointer devices get prev/next buttons, because a mouse
 * (no horizontal wheel axis, no drag-to-scroll) would otherwise have no way to
 * reach anything past the first visible cards. The buttons are hidden below
 * `sm`, where swiping is the natural gesture and they would only cover cards.
 */
export default function ProductRail({ label, children }: ProductRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // 1px slack: fractional widths mean scrollLeft rarely hits the exact bound.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    // Card count and viewport both change what's reachable; ResizeObserver
    // catches breakpoint changes and late-loading images without a resize event.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [sync, children]);

  const page = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Scroll just under a full viewport so the card at the seam stays in view.
    el.scrollBy({
      left: direction * el.clientWidth * 0.9,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const arrowBase =
    'absolute top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full ' +
    'bg-obsidian-raised/95 p-2 text-ink shadow-lg ring-1 ring-ink/10 backdrop-blur ' +
    'transition hover:bg-obsidian-raised focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-gold sm:flex';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => page(-1)}
        // Kept out of the tab order and hidden from AT: the cards themselves are
        // focusable, so tabbing already scrolls the rail. These are pointer aids.
        tabIndex={-1}
        aria-hidden="true"
        className={`${arrowBase} -left-3 lg:-left-5 ${canLeft ? '' : 'pointer-events-none opacity-0'}`}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div
        ref={scrollerRef}
        onScroll={sync}
        role="region"
        aria-label={label}
        className={RAIL_CONTAINER}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => page(1)}
        tabIndex={-1}
        aria-hidden="true"
        className={`${arrowBase} -right-3 lg:-right-5 ${canRight ? '' : 'pointer-events-none opacity-0'}`}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
