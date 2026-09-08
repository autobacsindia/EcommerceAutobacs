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
 * Hence SCROLL_LOCK_PX: past a few pixels of scroll the carousel snaps back to slide
 * 0 and stops, and it only resumes once the user is genuinely back at the top. The
 * frame scrub is never covered and never interrupted.
 *
 * Everything else here is the ordinary set of reasons not to animate at someone:
 * reduced motion, a backgrounded tab, a pointer resting on the hero, or keyboard
 * focus inside it.
 *
 * With `slideCount <= 1` the hook is completely inert — no timer, no listeners — so
 * when no spin campaign is live the hero behaves exactly as it did before this
 * existed.
 */

/**
 * Dwell is PER SLIDE, not one interval, because the two slides have opposite needs.
 *
 * The carousel can only ever rotate while the user is at the top of the page (see the
 * scroll lock below). That is a budget of a few seconds for the whole rotation, so the
 * car slide has to hand over quickly or a visitor who scrolls at a normal pace never
 * learns the campaign exists at all.
 *
 * The spin slide is the opposite: HeroSpinWheel's needle takes SPIN_DURATION_MS (2.6s)
 * to land, and the "Could land on — X" line only means anything once it has. Giving it
 * the car's dwell would cut the wheel off just after it settles, every single time.
 *
 * So: reveal fast, then hold. `HeroSpinWheel.test.tsx` pins SPIN_DWELL_MS against the
 * spin duration so the two cannot drift apart.
 */
/** Car slide → spin slide. Short, because the rotation only gets one shot. */
export const CAR_DWELL_MS = 3000;
/** Spin slide → car slide. Must outlast the 2.6s wheel spin with reading time left. */
export const SPIN_DWELL_MS = 6000;

/** Slide 1 is the spin teaser; anything else is the car stage. */
export function dwellMsFor(index: number): number {
  return index === 1 ? SPIN_DWELL_MS : CAR_DWELL_MS;
}

/**
 * Scroll past this and the carousel locks to the car slide.
 *
 * Small but non-zero: iOS reports a few pixels of scroll from rubber-banding at rest,
 * and 0 would latch the lock on a page nobody has actually scrolled.
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
      const isLocked = window.scrollY > SCROLL_LOCK_PX;
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
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled, nearViewport]);

  // ── Pause signals ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => setPaused(document.hidden);
    const pause = () => setPaused(true);
    const resume = () => setPaused(false);

    // Reduced motion is a hard stop, not a pause: nothing should re-enable it.
    if (motion.matches) {
      setPaused(true);
      return;
    }

    setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    el?.addEventListener('pointerenter', pause);
    el?.addEventListener('pointerleave', resume);
    // Keyboard users get the same courtesy as mouse users: a slide must not move out
    // from under the element they just tabbed to.
    el?.addEventListener('focusin', pause);
    el?.addEventListener('focusout', resume);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      el?.removeEventListener('pointerenter', pause);
      el?.removeEventListener('pointerleave', resume);
      el?.removeEventListener('focusin', pause);
      el?.removeEventListener('focusout', resume);
    };
  }, [enabled, containerRef]);

  // ── The timer ──────────────────────────────────────────────────────────────
  // A self-rescheduling timeout rather than an interval: dwell depends on which slide
  // is showing, and an interval has one fixed period by definition. `index` in the deps
  // is what re-arms it — every advance tears down the old timer and arms the next one
  // at the new slide's dwell.
  useEffect(() => {
    if (!enabled || locked || paused || userPicked) return;
    const id = window.setTimeout(
      () => setIndex((i) => (i + 1) % slideCount),
      dwellMsFor(index),
    );
    return () => window.clearTimeout(id);
  }, [enabled, locked, paused, userPicked, slideCount, index]);

  // A campaign ending mid-session shrinks slideCount under a non-zero index.
  useEffect(() => {
    if (index > slideCount - 1) setIndex(0);
  }, [index, slideCount]);

  return { index: enabled ? index : 0, goTo, locked };
}

export default useHeroCarousel;
