'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';

/**
 * Floating "Need help?" tab pinned to the right edge, linking to /contact.
 *
 * Context: this is a fresh build replacing the legacy WooCommerce site, so we
 * give users a persistent, low-friction escape hatch to reach us if something
 * looks broken. It is deliberately unobtrusive (a thin edge tab) and can be
 * dragged vertically so it never permanently covers page content the user needs.
 *
 * Interaction notes:
 *  • Drag is vertical only — the widget stays flush with the right edge.
 *  • A pointer gesture under DRAG_THRESHOLD px counts as a click → navigate;
 *    anything more is treated as a drag and suppresses navigation, so users
 *    never get bounced to /contact while repositioning it.
 *  • Position is stored as a viewport-height ratio (survives window resizes)
 *    in localStorage so it stays where the user left it across pages/visits.
 */

const STORAGE_KEY = 'help-widget-top-ratio';
const DEFAULT_RATIO = 0.62; // lower-middle of the viewport by default
const DRAG_THRESHOLD = 6; // px of travel before a gesture becomes a drag
const EDGE_MARGIN = 12; // keep the tab clear of the very top/bottom edges
const MOBILE_BREAKPOINT = 768; // matches StickyCartBar's `md:hidden`
// On mobile PDPs a full-width sticky Add-to-Cart bar (z-50) hugs bottom-0.
// Reserve enough bottom clearance that the widget can never be dragged over it
// (bar ≈72px + iOS home-indicator safe area). Desktop keeps the small margin.
const MOBILE_BOTTOM_RESERVE = 96;

/** Bottom clearance for the current viewport, incl. the iOS safe-area inset. */
function bottomMargin(): number {
  const base = window.innerWidth < MOBILE_BREAKPOINT ? MOBILE_BOTTOM_RESERVE : EDGE_MARGIN;
  return base + safeAreaBottom();
}

/** Reads env(safe-area-inset-bottom) in px (0 where unsupported). */
function safeAreaBottom(): number {
  if (typeof window === 'undefined' || !window.CSS?.supports?.('top: env(safe-area-inset-bottom)')) {
    return 0;
  }
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return Number.isFinite(h) ? h : 0;
}

/** Routes where the widget would be noise or get in the way. */
function isSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/checkout') ||
    pathname === '/contact' ||
    pathname === '/login' ||
    pathname === '/register'
  );
}

/**
 * Clamp a desired top to the on-screen range. `height` (tab height) and
 * `bottom` (bottom clearance incl. safe-area) are passed in from cached
 * metrics — never measured here — so this stays cheap enough to call on every
 * pointermove without forcing a layout reflow.
 */
function clampTop(top: number, height: number, bottom: number): number {
  const max = window.innerHeight - height - bottom;
  return Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, max));
}

export default function HelpWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);

  const [mounted, setMounted] = useState(false);
  const [top, setTop] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Drag bookkeeping kept in a ref so listeners see fresh values without re-binding.
  // `lastTop` mirrors the latest committed top so endDrag can persist it without
  // reaching into (possibly stale) render state or a setState updater.
  const drag = useRef({ active: false, moved: false, startY: 0, startTop: 0, lastTop: 0 });

  // Cached layout metrics — the tab height and bottom clearance only change on
  // mount/resize, so we measure them there (safeAreaBottom() touches the DOM)
  // and read the cache during drag to avoid a reflow on every pointermove.
  const metrics = useRef({ height: 120, bottom: EDGE_MARGIN });
  const measure = useCallback(() => {
    metrics.current.height = ref.current?.offsetHeight ?? 120;
    metrics.current.bottom = bottomMargin();
  }, []);

  // The usable travel range denominator, so save/restore round-trip exactly.
  const travel = useCallback(() => Math.max(window.innerHeight - metrics.current.height, 1), []);

  // Resolve the initial position from the saved ratio once we're on the client.
  useEffect(() => {
    measure();
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const ratio = raw != null ? parseFloat(raw) : DEFAULT_RATIO;
    const safeRatio = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : DEFAULT_RATIO;
    setTop(clampTop(travel() * safeRatio, metrics.current.height, metrics.current.bottom));
    setMounted(true);
  }, [measure, travel]);

  // Re-clamp on resize so the tab never drifts off-screen.
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      measure();
      setTop((t) => clampTop(t, metrics.current.height, metrics.current.bottom));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted, measure]);

  const persist = useCallback(
    (nextTop: number) => {
      // Store as a fraction of the same travel range restore multiplies back by,
      // so the tab returns to exactly where it was dropped.
      const ratio = nextTop / travel();
      try {
        localStorage.setItem(STORAGE_KEY, String(ratio));
      } catch {
        /* private mode / quota — non-critical */
      }
    },
    [travel],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Ignore secondary buttons; let normal focus/keyboard handling proceed.
    if (e.button !== 0) return;
    drag.current = {
      active: true,
      moved: false,
      startY: e.clientY,
      startTop: top,
      lastTop: top,
    };
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return;
    const dy = e.clientY - drag.current.startY;
    if (!drag.current.moved && Math.abs(dy) > DRAG_THRESHOLD) {
      drag.current.moved = true;
      setDragging(true);
    }
    if (drag.current.moved) {
      const next = clampTop(drag.current.startTop + dy, metrics.current.height, metrics.current.bottom);
      drag.current.lastTop = next;
      setTop(next);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return;
    ref.current?.releasePointerCapture?.(e.pointerId);
    const wasDrag = drag.current.moved;
    const finalTop = drag.current.lastTop;
    drag.current.active = false;
    drag.current.moved = false;
    setDragging(false);
    if (wasDrag) {
      persist(finalTop);
    } else {
      router.push('/contact');
    }
  };

  if (isSuppressed(pathname) || !mounted) return null;

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Need help? Contact us"
      title="Need help? Contact us"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        // Keyboard users can't drag — Enter/Space just navigates.
        // Ignore auto-repeat so a held key doesn't stack router.push calls.
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          router.push('/contact');
        }
      }}
      style={{ top: `${top}px`, touchAction: 'none' }}
      className={`group fixed right-0 z-[60] flex select-none flex-col items-center gap-1.5
        rounded-l-xl border border-r-0 border-gold/30 bg-obsidian-raised/95 px-2 py-3 sm:px-2.5 sm:py-3.5
        text-gold shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur
        transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
        hover:bg-obsidian-raised hover:shadow-[0_10px_28px_rgba(0,0,0,0.6)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60
        ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
    >
      <LifeBuoy
        className="h-5 w-5 shrink-0 transition-transform duration-300 group-hover:rotate-12"
        aria-hidden="true"
      />
      <span
        className="font-display text-[10px] font-semibold uppercase leading-none tracking-[0.14em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        Need help?
      </span>
    </button>
  );
}
