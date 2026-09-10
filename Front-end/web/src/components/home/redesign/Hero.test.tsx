import { act, render, screen } from '@testing-library/react';
import Hero from './Hero';
import type { SpinTeaser } from './homeData';
import { SLIDE_DWELL_MS } from './useHeroCarousel';

/**
 * DRIFT GUARD for the pinned frame sequence.
 *
 * The hero carousel was added under one hard requirement: it must not disturb the
 * scroll-scrubbed car animation. That animation is invisible to a unit test — it paints
 * to a canvas from a WebP frame set — so what is asserted here instead is the STRUCTURE
 * the animation depends on:
 *
 *   1. HeroSequence receives the `.hero-pin` ref, not a slide ref. It measures that
 *      element's bounding box to decide which frame to draw; hand it anything else and
 *      the scrub silently maps to the wrong scroll range.
 *   2. The canvas is mounted ONCE and survives a slide change. Unmounting it would
 *      throw away every decoded ImageBitmap and restart the preload — a change that
 *      looks harmless in a diff and is expensive and janky in a browser.
 *   3. With no live campaign the hero is single-slide and the carousel is inert.
 *
 * If someone later "simplifies" Hero.tsx by moving the carousel up around .hero-pin, or
 * by conditionally rendering the car slide, these fail. That is the whole point.
 */

// Capture what HeroSequence is handed, without running any canvas/fetch machinery.
const sequenceCalls: { sectionRef: React.RefObject<HTMLElement | null> }[] = [];
let sequenceMountCount = 0;

jest.mock('./HeroSequence', () => {
  const React = jest.requireActual('react');
  function MockHeroSequence(props: { sectionRef: React.RefObject<HTMLElement | null> }) {
    sequenceCalls.push(props);
    React.useEffect(() => {
      sequenceMountCount += 1;
    }, []);
    return React.createElement('canvas', { 'data-testid': 'hero-seq' });
  }
  return { __esModule: true, default: MockHeroSequence };
});

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

const teaser: SpinTeaser = {
  slug: 'diwali',
  name: 'Diwali Rewards',
  endsAt: new Date(Date.now() + 86400000).toISOString(),
  minOrderValuePaise: 0,
  maxSpinsPerUserPerCampaign: 1,
  terms: null,
  prizes: [
    { name: 'Dash Cam', shortLabel: 'Dash Cam', imageUrl: null, kind: 'goodie' },
    { name: 'Steel Mug', shortLabel: 'Steel Mug', imageUrl: null, kind: 'goodie' },
    { name: 'Fuel Cap', shortLabel: 'Fuel Cap', imageUrl: null, kind: 'goodie' },
  ],
};

describe('Hero — the frame sequence must survive the carousel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
    sequenceCalls.length = 0;
    sequenceMountCount = 0;
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hands HeroSequence the .hero-pin element, not a carousel slide', () => {
    const { container } = render(<Hero spinTeaser={teaser} />);

    const pin = container.querySelector('.hero-pin');
    expect(pin).toBeTruthy();
    expect(sequenceCalls.length).toBeGreaterThan(0);
    // The scrub distance is `pin.offsetHeight - viewportHeight`. A slide ref is
    // 100vh tall, so that distance would collapse to ~0 and the sequence would jump
    // from frame 0 to the last frame in a single scroll step.
    expect(sequenceCalls[sequenceCalls.length - 1].sectionRef.current).toBe(pin);
  });

  it('keeps the canvas inside the car slide and mounted across a slide change', () => {
    render(<Hero spinTeaser={teaser} />);

    const canvas = screen.getByTestId('hero-seq');
    expect(canvas.closest('.hero-slide')).toBeTruthy();
    expect(sequenceMountCount).toBe(1);

    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });

    // Same node, still mounted: the slide change is a transform, not a remount, so
    // every decoded ImageBitmap and the in-flight preload survive.
    expect(screen.getByTestId('hero-seq')).toBe(canvas);
    expect(sequenceMountCount).toBe(1);
  });

  it('moves the track by transform only — .hero-pin and .hero keep their own boxes', () => {
    const { container } = render(<Hero spinTeaser={teaser} />);
    const track = container.querySelector<HTMLElement>('.hero-carousel')!;

    expect(track.style.transform).toBe('translate3d(-0%, 0, 0)');
    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });
    expect(track.style.transform).toBe('translate3d(-100%, 0, 0)');

    // Nothing the scrub measures was touched.
    expect(container.querySelector('.hero-pin')!.getAttribute('style')).toBeNull();
    expect(container.querySelector('.hero')!.getAttribute('style')).toBeNull();
  });

  /*
    Move the pin, not the window.

    The lock is measured from `.hero-pin`'s own bounding box, so a test that only sets
    `window.scrollY` is testing nothing — and that is exactly the coupling that let the
    phone bug through. `top` is negative once the track has risen above the viewport top.
  */
  function scrollPinTo(container: HTMLElement, top: number) {
    const pin = container.querySelector<HTMLElement>('.hero-pin')!;
    jest.spyOn(pin, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(50);
    });
  }

  /*
    ── Regression: the carousel was dead on phones ──────────────────────────
    The lock used to read `window.scrollY`. That equals the hero's scrub progress only
    when the hero is the first thing on the page — true on desktop, false on a phone,
    where `.hr-promo-slot` sits in normal flow ABOVE the hero instead of being an
    absolute overlay. With a promo strip live, a phone user scrolls ~64px+ just to bring
    the hero to the top; that tripped the 8px threshold and locked the carousel before
    they had looked at it, killing both the rotation and the dots.

    The page has scrolled here and the pin has NOT — which is the whole distinction.
  */
  it('keeps rotating when the page has scrolled but the pin has not reached the top', () => {
    const { container } = render(<Hero spinTeaser={teaser} />);
    const track = container.querySelector<HTMLElement>('.hero-carousel')!;

    // 240px of promo strip scrolled away; the pin's top is still below the viewport top.
    Object.defineProperty(window, 'scrollY', { value: 240, writable: true, configurable: true });
    scrollPinTo(container, 40);

    expect(container.querySelector('.hero-dots')).not.toBeNull();
    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });
    expect(track.style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('locks back to the car slide as soon as the user scrolls into the scrub', () => {
    const { container } = render(<Hero spinTeaser={teaser} />);
    const track = container.querySelector<HTMLElement>('.hero-carousel')!;

    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });
    expect(track.style.transform).toBe('translate3d(-100%, 0, 0)');

    scrollPinTo(container, -500);

    expect(track.style.transform).toBe('translate3d(-0%, 0, 0)');
    // Dots over a pinned, scrubbing animation are clutter and control nothing.
    expect(container.querySelector('.hero-dots')).toBeNull();

    /*
      The snap-back must not animate like a deliberate advance. Without this class the
      track runs the 0.8s "change of subject" slide at the exact moment the user starts
      scrolling — a slow horizontal motion against their vertical one, which is what
      makes a correct lock read as the carousel jumping on its own. jsdom does not
      compute the transition, so the class is the honest thing to assert; the duration
      behind it lives in home-redesign.css.
    */
    expect(track).toHaveClass('is-snapping-back');
  });

  it('animates a timed advance at full length, not the snap-back speed', () => {
    // The mirror of the test above: an advance the viewer did not interrupt keeps the
    // unhurried transition. One class doing both jobs would mean tuning one breaks the
    // other, so pin that they are distinguishable.
    const { container } = render(<Hero spinTeaser={teaser} />);
    const track = container.querySelector<HTMLElement>('.hero-carousel')!;

    expect(track).not.toHaveClass('is-snapping-back');
    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });
    expect(track.style.transform).toBe('translate3d(-100%, 0, 0)');
    expect(track).not.toHaveClass('is-snapping-back');
  });

  describe('with no live campaign', () => {
    it('renders a single slide and never moves', () => {
      const { container } = render(<Hero spinTeaser={null} />);

      expect(container.querySelectorAll('.hero-slide')).toHaveLength(1);
      expect(container.querySelector('.hero-dots')).toBeNull();

      const track = container.querySelector<HTMLElement>('.hero-carousel')!;
      act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS * 4); });
      expect(track.style.transform).toBe('translate3d(-0%, 0, 0)');
    });
  });

  it('drops a campaign that expired while the page sat in the ISR cache', () => {
    // Nothing writes to a campaign when it expires, so no cache tag can fire at
    // `endsAt` — without this render-time check the home page would keep advertising
    // a closed promotion for up to the full 300s revalidate window.
    const expired: SpinTeaser = { ...teaser, endsAt: new Date(Date.now() - 1000).toISOString() };
    const { container } = render(<Hero spinTeaser={expired} />);

    expect(container.querySelectorAll('.hero-slide')).toHaveLength(1);
    expect(screen.queryByText(/Diwali Rewards/)).not.toBeInTheDocument();
  });

  it('marks the off-screen slide inert so it takes no clicks or tab stops', () => {
    const { container } = render(<Hero spinTeaser={teaser} />);
    const slides = container.querySelectorAll('.hero-slide');

    expect(slides[0]).not.toHaveAttribute('inert');
    expect(slides[1]).toHaveAttribute('inert');

    act(() => { jest.advanceTimersByTime(SLIDE_DWELL_MS); });

    const after = container.querySelectorAll('.hero-slide');
    expect(after[0]).toHaveAttribute('inert');
    expect(after[1]).not.toHaveAttribute('inert');
  });
});
