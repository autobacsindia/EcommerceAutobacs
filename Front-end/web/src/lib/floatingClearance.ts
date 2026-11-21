/**
 * Keeps the floating "Contact us" button off the buttons that sell.
 *
 * Two things on a product page own the phone screen's bottom edge, and the
 * floating button must never sit on either:
 *
 *  - the sticky buy bar (StickyCartBar) — it reports its live height here, and
 *    the button lifts that far (0 when the bar is hidden, and on desktop where
 *    the bar is `md:hidden` and measures 0);
 *  - the in-page Add to cart / Buy now / wishlist block (BuyBox) — it reports
 *    whether it is on screen, and the button steps aside while it is.
 *
 * A tiny external store rather than context: the reporters and the button live
 * in different trees (product page vs root layout), and neither should re-render
 * the other's parents. Server snapshot is "nothing to avoid", so SSR and the
 * first client render agree and the button paints where it always did.
 */
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

export interface FloatingClearance {
  /** Height in px of the sticky buy bar while it is showing, else 0. */
  buyBarHeight: number;
  /** True while any buy-button block is on screen. */
  buyButtonsInView: boolean;
}

const NOTHING: FloatingClearance = { buyBarHeight: 0, buyButtonsInView: false };

let state: FloatingClearance = NOTHING;
const listeners = new Set<() => void>();
const blockersInView = new Set<object>();

function emit(next: FloatingClearance) {
  if (next.buyBarHeight === state.buyBarHeight && next.buyButtonsInView === state.buyButtonsInView) return;
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBuyBarHeight(px: number): void {
  emit({ ...state, buyBarHeight: Math.max(0, Math.round(px)) });
}

export function setBuyButtonsInView(token: object, inView: boolean): void {
  if (inView) blockersInView.add(token);
  else blockersInView.delete(token);
  emit({ ...state, buyButtonsInView: blockersInView.size > 0 });
}

/** Test-only: back to a clean page. */
export function resetFloatingClearance(): void {
  blockersInView.clear();
  emit(NOTHING);
}

export function useFloatingClearance(): FloatingClearance {
  return useSyncExternalStore(subscribe, () => state, () => NOTHING);
}

/**
 * Put on the element holding Add to cart / Buy now / wishlist: while any of it
 * is on screen the floating Contact button steps aside.
 */
export function useKeepFloatingButtonsClear<T extends Element>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const token = {};
    const io = new IntersectionObserver(([entry]) => setBuyButtonsInView(token, !!entry?.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      setBuyButtonsInView(token, false);
    };
  }, []);
  return ref;
}

/**
 * Put on the sticky buy bar: reports its rendered height (it grows a line in a
 * sale) so the Contact button sits just above it. `shown` is the bar's own
 * visibility flag (it renders nothing while hidden); reports 0 when hidden.
 */
export function useReportBuyBarHeight<T extends HTMLElement>(shown: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    setBuyBarHeight(el.offsetHeight);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => setBuyBarHeight(el.offsetHeight));
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      setBuyBarHeight(0);
    };
  }, [shown]);
  return ref;
}
