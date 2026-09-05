'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Two-way binding between a CSS scroll-snap strip and an `active` index.
 *
 * Why scroll-snap rather than Embla/Swiper: this is native momentum scrolling.
 * Rubber-banding, fling velocity, interrupted swipes, RTL, and every iOS/Android
 * quirk we will never own a device to test are handled by the compositor, off
 * the main thread, for 0 KB of bundle. A JS carousel reimplements all of that in
 * a scroll handler and gets it subtly wrong on the phones our customers use.
 *
 * The hook supplies the two pieces CSS cannot: reporting which slide the user
 * landed on, and driving the strip when the index is changed from elsewhere
 * (a thumbnail click, lightbox navigation).
 *
 * CONTRACT: slides must be the scroller's direct children AND keyed by
 * POSITION, not by content. The observer is attached to the nodes present when
 * the slide count last changed; if a same-length list swapped every key, React
 * would replace those nodes and the observer would be left watching detached
 * elements — the counter and dots would freeze while the strip still scrolled.
 *
 * `onActiveChange` is held in a ref, so callers may pass an inline closure
 * without tearing down and rebuilding the IntersectionObserver every render.
 */

// Positioning the strip must happen before paint or the user sees it jump from
// slide 0. `useLayoutEffect` warns when React renders on the server, so pick the
// effect once at module scope — the choice is constant for the process lifetime,
// which keeps hook order stable.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Safety valve for the programmatic-scroll guard below. A smooth scroll across
 * a long strip takes a few hundred ms; if it never arrives (the element was
 * hidden, the list changed underneath it) this releases the guard so the
 * observer regains control instead of going permanently deaf.
 */
const PROGRAMMATIC_SCROLL_TIMEOUT_MS = 1200;

interface SnapPagerOptions {
  /** Number of slides. Slides must be the scroller's direct children. */
  count: number;
  /** Currently selected slide. */
  active: number;
  /** Called when the user scrolls a different slide into view. */
  onActiveChange: (index: number) => void;
  /** Animate index-driven scrolls. Pass false for reduced motion. */
  smooth?: boolean;
}

export interface SnapPager {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Imperatively scroll to a slide (used to position the strip on open). */
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
}

export function useSnapPager({
  count,
  active,
  onActiveChange,
  smooth = true,
}: SnapPagerOptions): SnapPager {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onActiveChange);
  onChangeRef.current = onActiveChange;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Slide a programmatic scroll is currently travelling to, or `null` when the
  // strip is under the customer's control. See the observer for why.
  const pendingTargetRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  // Last index the observer pushed out, or `null` if the most recent move was
  // programmatic. This is how the effect below tells "the customer swiped here"
  // from "something else asked for this slide" — a distinction the scroll offset
  // cannot make, because the observer reports mid-swipe. See that effect.
  const reportedRef = useRef<number | null>(null);

  const releasePending = useCallback(() => {
    pendingTargetRef.current = null;
    if (pendingTimerRef.current != null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'auto') => {
      const el = scrollerRef.current;
      const target = el?.children[index] as HTMLElement | undefined;
      if (!el || !target || typeof el.scrollTo !== 'function') return;

      // Already there — nothing will move, so no slide will sweep past, so
      // there is nothing to guard against. Arming anyway would go deaf to the
      // customer for the full safety timeout: the mount effect below always
      // calls this, and on the common "opens at slide 1" path it is a scroll
      // from 0 to 0.
      if (Math.abs(el.scrollLeft - target.offsetLeft) < 2) return;

      // The strip is being sent somewhere; whatever the customer last scrolled
      // to is now history and must not suppress a later move back to it.
      reportedRef.current = null;
      pendingTargetRef.current = index;
      if (pendingTimerRef.current != null) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = window.setTimeout(releasePending, PROGRAMMATIC_SCROLL_TIMEOUT_MS);

      el.scrollTo({ left: target.offsetLeft, behavior });
    },
    [releasePending]
  );

  useEffect(() => releasePending, [releasePending]);

  // Report the slide the user scrolled to.
  //
  // IntersectionObserver rather than a scroll listener: it fires only on
  // threshold crossings instead of on every one of the ~100 scroll events a
  // single fling produces, and it needs no debounce to know when the fling
  // settled. It is also self-disabling — a `display: none` scroller (this strip
  // on desktop, or the lightbox while closed) reports nothing, so the two
  // breakpoint variants of the gallery cannot fight over the shared index.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || count < 2 || typeof IntersectionObserver !== 'function') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Majority-visible wins. With `snap-mandatory` exactly one slide can
          // exceed 50% once the scroll settles, so this cannot oscillate.
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;

          // Resolved against the live DOM rather than a captured array, so a
          // node that has been replaced reports -1 and is skipped instead of
          // being mistaken for whatever now sits at its old position.
          const index = Array.prototype.indexOf.call(el.children, entry.target);
          if (index < 0) continue;

          const pending = pendingTargetRef.current;
          if (pending !== null) {
            // A programmatic jump is in flight. EVERY slide between the start
            // and the target crosses 50% on the way past, and reporting one
            // would push a new `active` into the effect below, which would
            // retarget the in-flight animation to that intermediate slide —
            // tapping thumbnail 5 would land the customer on image 2. Stay
            // silent until the strip actually reaches where it was sent.
            if (index === pending) releasePending();
            continue;
          }

          // Recorded even when the index is unchanged, so a swipe out to a
          // neighbour and back leaves the strip's own position on record.
          reportedRef.current = index;
          if (index !== activeRef.current) onChangeRef.current(index);
        }
      },
      { root: el, threshold: [0.5, 0.75] }
    );

    Array.from(el.children).forEach((slide) => io.observe(slide));

    // A touch or wheel on the strip means the customer has taken over. Drop any
    // in-flight target immediately, rather than making them wait out the safety
    // timeout before their own swipe moves the counter again.
    el.addEventListener('pointerdown', releasePending, { passive: true });
    el.addEventListener('touchstart', releasePending, { passive: true });
    el.addEventListener('wheel', releasePending, { passive: true });

    return () => {
      io.disconnect();
      el.removeEventListener('pointerdown', releasePending);
      el.removeEventListener('touchstart', releasePending);
      el.removeEventListener('wheel', releasePending);
    };
  }, [count, releasePending]);

  // Position without animation on mount, so a strip that opens at slide 3
  // (lightbox launched from the third thumbnail) starts there rather than
  // animating across every image in between.
  useIsomorphicLayoutEffect(() => {
    scrollToIndex(activeRef.current, 'auto');
  }, [scrollToIndex]);

  // Drive the strip when the index changes from outside.
  //
  // "From outside" is the whole difficulty. The observer reports at 50%
  // visibility — mid-swipe, finger still down — so a user-originated change
  // arrives while the strip is nowhere near the target offset. Deciding by
  // offset alone therefore reads every swipe as an external change and fires a
  // smooth scroll into the customer's live native scroll: two owners of
  // `scrollLeft` plus `snap-mandatory` re-snapping on top, which is the visible
  // stutter. It also arms the observer's pending guard, which then swallows the
  // rest of the fling and freezes the counter mid-gesture.
  //
  // So origin is tracked explicitly rather than inferred: `reportedRef` holds
  // the index the observer last pushed out, and a match means the strip is
  // already travelling there under its own momentum. Never command it — the
  // compositor is doing a better job than we can.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (active === reportedRef.current) return;
    const el = scrollerRef.current;
    const target = el?.children[active] as HTMLElement | undefined;
    if (!el || !target) return;
    // Cheap second line of defence for a settled strip that is already in place.
    if (Math.abs(el.scrollLeft - target.offsetLeft) < 2) return;
    scrollToIndex(active, smooth ? 'smooth' : 'auto');
  }, [active, smooth, scrollToIndex]);

  return { scrollerRef, scrollToIndex };
}
