import { act, renderHook } from '@testing-library/react';
import useHeroCarousel, { SLIDE_INTERVAL_MS, SCROLL_LOCK_PX } from './useHeroCarousel';

/**
 * The hook that keeps the hero carousel from eating the pinned frame sequence.
 *
 * The behaviour under test is not "does a carousel advance" — it is the scroll lock.
 * `.hero` is sticky-pinned for 300vh while HeroSequence scrubs the car against scroll
 * position, so a slide change mid-scroll would slide a poster over a half-played
 * animation. Nothing in the rendered output would look broken; the sequence would just
 * play to nobody. These tests are the only thing standing between that and a release.
 */

// jsdom has no matchMedia; every test wants "motion allowed" unless it says otherwise.
function mockMatchMedia(reducedMotion = false) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
    // The listener is rAF-throttled; jsdom's rAF is a macrotask under fake timers.
    jest.advanceTimersByTime(20);
  });
}

const noRef = { current: null };

describe('useHeroCarousel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    // Deterministic rAF so the throttled scroll handler runs under fake timers.
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => cb(performance.now()), 0) as unknown as number;
    });
  });

  afterEach(() => {
    // Flush inside act(): a pending interval fires setIndex on a still-mounted hook,
    // which React would otherwise warn about as an unwrapped update.
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('with a single slide (no live campaign)', () => {
    it('is completely inert — no timer, and the index never leaves 0', () => {
      const { result } = renderHook(() => useHeroCarousel(1, noRef));

      expect(result.current.index).toBe(0);
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS * 5); });
      expect(result.current.index).toBe(0);
      // Nothing to lock: the hero renders exactly as it did before the carousel existed.
      expect(result.current.locked).toBe(false);
    });
  });

  describe('with two slides', () => {
    it('advances once per interval and wraps back round', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      expect(result.current.index).toBe(0);
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(0);
    });

    it('does not advance before the full interval has elapsed', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS - 1); });
      expect(result.current.index).toBe(0);
    });

    // ── The scroll lock: the reason this hook exists ────────────────────────
    it('snaps back to the car slide and stops as soon as the user scrolls', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);

      scrollTo(SCROLL_LOCK_PX + 1);

      expect(result.current.locked).toBe(true);
      // Back on the car BEFORE any scrub progress is visible.
      expect(result.current.index).toBe(0);

      // And it stays there for the whole 300vh pin, however long the user scrubs.
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS * 10); });
      expect(result.current.index).toBe(0);
    });

    it('tolerates a few pixels of rubber-band scroll without locking', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));
      scrollTo(SCROLL_LOCK_PX);
      expect(result.current.locked).toBe(false);
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);
    });

    it('resumes rotating once the user returns to the top', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      scrollTo(400);
      expect(result.current.locked).toBe(true);

      scrollTo(0);
      expect(result.current.locked).toBe(false);
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);
    });

    it('never autoplays under prefers-reduced-motion', () => {
      mockMatchMedia(true);
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS * 4); });
      expect(result.current.index).toBe(0);
    });

    it('pauses in a backgrounded tab and resumes when it comes back', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      act(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS * 3); });
      expect(result.current.index).toBe(0);

      act(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);
    });

    it('stops rotating after a manual pick, so a chosen slide is not yanked away', () => {
      const { result } = renderHook(() => useHeroCarousel(2, noRef));

      act(() => { result.current.goTo(1); });
      expect(result.current.index).toBe(1);

      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS * 3); });
      expect(result.current.index).toBe(1);
    });

    /*
      ── Optimization regression guard ────────────────────────────────────────
      Before the IntersectionObserver was added, 200 scroll events fired far below
      the hero produced 200 rAF callbacks and 200 handler runs — per-frame work for
      a hero-only concern, for the whole life of a long home page. This pins the
      fix: once the hero is reported off-screen the listener is gone, and scrolling
      the rest of the page costs nothing.
    */
    it('stops doing per-scroll work once the hero leaves the viewport', () => {
      const realIO = global.IntersectionObserver;
      let notify: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
      const disconnect = jest.fn();
      // @ts-expect-error — minimal stand-in for the real observer
      global.IntersectionObserver = class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { notify = cb; }
        observe() {}
        unobserve() {}
        disconnect() { disconnect(); }
        takeRecords() { return []; }
      };

      const el = document.createElement('section');
      document.body.appendChild(el);
      const { result } = renderHook(() => useHeroCarousel(2, { current: el }));

      const raf = window.requestAnimationFrame as jest.Mock;
      act(() => { notify!([{ isIntersecting: false }]); });

      // Leaving the hero behind is itself proof of scrolling: locked without needing
      // a single scroll event to say so.
      expect(result.current.locked).toBe(true);
      expect(result.current.index).toBe(0);

      raf.mockClear();
      act(() => {
        for (let i = 0; i < 200; i++) {
          Object.defineProperty(window, 'scrollY', { value: 5000 + i * 20, writable: true, configurable: true });
          window.dispatchEvent(new Event('scroll'));
          jest.advanceTimersByTime(20);
        }
      });
      expect(raf).not.toHaveBeenCalled();

      // Coming back re-attaches and re-reads the real offset.
      act(() => {
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
        notify!([{ isIntersecting: true }]);
      });
      expect(result.current.locked).toBe(false);

      el.remove();
      global.IntersectionObserver = realIO;
    });

    it('clears its timer on unmount', () => {
      const clear = jest.spyOn(window, 'clearInterval');
      const { unmount } = renderHook(() => useHeroCarousel(2, noRef));
      unmount();
      expect(clear).toHaveBeenCalled();
    });

    it('falls back to slide 0 if the campaign ends and the slide count shrinks', () => {
      const { result, rerender } = renderHook(
        ({ count }) => useHeroCarousel(count, noRef),
        { initialProps: { count: 2 } },
      );
      act(() => { jest.advanceTimersByTime(SLIDE_INTERVAL_MS); });
      expect(result.current.index).toBe(1);

      rerender({ count: 1 });
      expect(result.current.index).toBe(0);
    });
  });
});
