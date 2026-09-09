'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Autoplay controller for the hero carousel.
 *
 * ── The rule this hook exists to enforce ─────────────────────────────────────
 * The hero is not a normal hero. `.hero` is sticky-pinned inside a 300vh (desktop)
 * / 180vh (mobile) `.hero-pin` track, and HeroSequence scrubs a WebP frame sequence
 * against scroll position for that whole distance. So "auto-advance every N seconds"
 * can only mean "while the user is at the top of the page" — otherwise, twelve
 * seconds into someone's scroll, the poster slides in over a half-played car
 * animation and the pinned sequence plays to an audience of nobody.
 *
 * Hence SCROLL_LOCK_PX: once the PIN has travelled a few pixels above the viewport top
 * the carousel snaps back to slide 0 and stops, resuming only when the scrub is back at
 * its start. The frame scrub is never covered and never interrupted. Note it is the
 * pin's position, not the window's — see the constant for why that distinction is the
 * difference between working and not working on a phone.
 *
 * Everything else here is the ordinary set of reasons not to animate at someone:
 * reduced motion, a backgrounded tab, or keyboard focus inside it. Notably NOT hover —
 * see the note beside the pause signals for why that one is actively wrong here.
 *
 * With `slideCount <= 1` the hook is completely inert — no timer, no listeners — so
 * when no spin campaign is live the hero behaves exactly as it did before this
 * existed.
 */

/**
 * Dwell per slide — the same for every slide, deliberately.
 *
 * The carousel only ever rotates while the hero has the screen (see the scroll lock
 * below), which is a budget of a few seconds for the whole rotation. At a longer dwell
 * a visitor scrolling at a normal pace never learns the campaign exists.
 *
 * ⚠ This is a ceiling on HeroSpinWheel's SPIN_DURATION_MS, not just a number. The
 * needle has to land AND the "Could land on — X" line has to be readable inside one
 * dwell, or the wheel is cut off mid-rotation every single time and the slide is a
 * blur. `HeroSpinWheel.test.tsx` holds the two together with a reading margin — if you
 * lengthen the spin, that test is what tells you the dwell no longer fits it.
 */
export const SLIDE_DWELL_MS = 3000;

/**
 * Pixels of the PIN scrolled past the viewport top before the carousel locks.
 *
 * Small but non-zero: iOS reports a few pixels of scroll from rubber-banding at rest,
 * and 0 would latch the lock on a page nobody has actually scrolled.
 *
 * ⚠ Measured from the pin's own bounding box, NOT from `window.scrollY`. Those are the
 * same number only when the hero is the first thing on the page — true on desktop,
 * FALSE on phones, where `.hr-promo-slot` is in normal flow above the hero rather than
 * an absolute overlay (see the `@media (max-width: 768px)` block in home-redesign.css).
 * With a promo strip live, a phone user must scroll ~64px+ just to bring the hero to
 * the top, which pushed `scrollY` past this threshold and locked the carousel before
 * they had looked at it: no rotation, and no dots either. The scrub had not started —
 * only the page above it had moved.
 */
export const SCROLL_LOCK_PX = 8;

export interface HeroCarouselApi {
  /** Currently visible slide. Always 0 while locked. */
  index: number;
  /** Manual selection (dots). Also cancels autoplay for this visit to the top. */
  goTo: (i: number) => void;
  /** True once the user has scrolled into the scrub — the UI hides its dots. */
  locked: boolean;
}

export function useHeroCarousel(
  slideCount: number,
  containerRef: React.RefObject<HTMLElement | null>,
  /**
   * The `.hero-pin` scroll track. Its distance above the viewport top IS the scrub
   * progress, which is the only thing the lock actually cares about.
   */
  trackRef?: React.RefObject<HTMLElement | null>,
): HeroCarouselApi {
  const [index, setIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  /*
    Whether the hero is anywhere near the screen.

    Starts TRUE and only ever goes false on an explicit "not intersecting" report, so
    an environment without a working IntersectionObserver keeps the plain
    always-listening behaviour rather than a carousel that never advances.
  */
  const [nearViewport, setNearViewport] = useState(true);
  // A manual pick is a statement of intent; we stop rotating under the user's cursor
  // rather than yanking them off the slide they chose.
  const [userPicked, setUserPicked] = useState(false);
  const [paused, setPaused] = useState(false);

  const enabled = slideCount > 1;

  const goTo = useCallback((i: number) => {
    setUserPicked(true);
    setIndex(i);
  }, []);

  /*
    ── Bound the scroll listener to the hero (optimization pass) ───────────────
    Measured: 200 scroll events fired well below the hero produced 200 rAF callbacks
    and 200 handler runs — a hero-only concern doing per-frame work for the entire
    life of a long home page, long after the carousel can do anything.

    HeroSequence already solves exactly this, in this same component tree, with an
    IntersectionObserver that attaches and detaches its scroll listener; this reuses
    that pattern rather than inventing a second one. Same 100px rootMargin.

    Leaving the hero behind is itself proof the user has scrolled, so the lock is
    applied on the way out — the state stays correct without a single scroll event.
  */
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      ([entry]) => {
        setNearViewport(entry.isIntersecting);
        if (!entry.isIntersecting) {
          setLocked(true);
          setIndex(0);
        }
      },
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, containerRef]);

  // ── Scroll lock ────────────────────────────────────────────────────────────
  // Its own listener rather than a hook into HeroSequence's: that one runs inside the
  // frame-scrub path and is deliberately minimal, and coupling the two would mean a
  // change to the carousel could regress the animation. rAF-throttled and passive, so
  // it cannot block or delay the scrub.
  useEffect(() => {
    if (!enabled || !nearViewport) return;
    let ticking = false;
    const read = () => {
      ticking = false;
      /*
        How far the track has travelled above the viewport top — positive once it has.

        `window.scrollY` is that same quantity expressed against the document rather than
        the element, used only when there is no track to measure. The signs differ
        because a rect top goes NEGATIVE as an element rises past the viewport top while
        scrollY goes positive: for a track sitting at the very top of the page,
        `track.top === -scrollY`. Same measurement, not a second strategy.
      */
      const track = trackRef?.current;
      const travelled = track ? -track.getBoundingClientRect().top : window.scrollY;
      const isLocked = travelled > SCROLL_LOCK_PX;
      setLocked(isLocked);
      // Snap back so the scrub always plays over the car, never the poster.
      if (isLocked) setIndex(0);
      // Returning to the top is a fresh visit: let it rotate again.
      else setUserPicked(false);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(read);
    };
    // Sync to the true offset on (re-)attach, the way HeroSequence primes its canvas:
    // scroll position may have changed entirely while we were not listening.
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    // A rotate or a URL-bar collapse moves the track without a scroll event.
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled, nearViewport, trackRef]);

  // ── Pause signals ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => setPaused(document.hidden);
    const pause = () => setPaused(true);
    const resume = () => setPaused(false);

    /*
      ⚠ NO POINTER PAUSE HERE — and it is not an oversight.

      "Pause on hover" is the right default for a carousel occupying a card in a page.
      This one is the whole stage: `.hero` is 100vh, so at the top of the page the cursor
      is inside it by definition. The old `pointerenter` listener fired on the first
      mouse move, latched `paused`, and its `pointerleave` partner could only fire by
      scrolling out of the hero — where the scroll lock has already stopped the rotation
      anyway. Net effect: on desktop, with a mouse, the carousel never auto-advanced at
      all. It looked like a broken timer and was really a pause that could never lift.

      Keyboard focus below is a different case and stays: `focusin` means the user is on
      a specific control inside the hero, which is a real signal, and moving a slide out
      from under a focused element is a genuine a11y failure. Hovering a full-screen
      stage signals nothing.
    */
    // Reduced motion is a hard stop, not a pause: nothing should re-enable it.
    if (motion.matches) {
      setPaused(true);
      return;
    }

    setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    // A slide must not move out from under the element the user just tabbed to.
    el?.addEventListener('focusin', pause);
    el?.addEventListener('focusout', resume);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      el?.removeEventListener('focusin', pause);
      el?.removeEventListener('focusout', resume);
    };
  }, [enabled, containerRef]);

  // ── The timer ──────────────────────────────────────────────────────────────
  // One fixed period, so an interval rather than a self-rescheduling timeout: `index`
  // stays OUT of the deps, and the rotation keeps an even cadence instead of resetting
  // its phase on every advance.
  useEffect(() => {
    if (!enabled || locked || paused || userPicked) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % slideCount),
      SLIDE_DWELL_MS,
    );
    return () => window.clearInterval(id);
  }, [enabled, locked, paused, userPicked, slideCount]);

  // A campaign ending mid-session shrinks slideCount under a non-zero index.
  useEffect(() => {
    if (index > slideCount - 1) setIndex(0);
  }, [index, slideCount]);

  return { index: enabled ? index : 0, goTo, locked };
}

export default useHeroCarousel;
