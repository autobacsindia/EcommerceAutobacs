/**
 * Tests — PDP touch carousel (`useSnapPager`).
 *
 * The strip scrolls natively; the hook only reports where the customer landed
 * and drives the strip when something ELSE changes the index. Confusing those
 * two directions is the bug this file exists for: the observer reports at 50%
 * visibility — mid-swipe, finger still down — so a hook that decides "was this
 * external?" by looking at the scroll offset reads every swipe as external and
 * fires a programmatic smooth scroll into the customer's live native scroll.
 * On a phone that is a visible stutter, and it drags the counter out of sync
 * with the photo for the length of the fling.
 *
 * These tests drive a real IntersectionObserver, because the suite-wide stub in
 * `jest.setup.js` is a no-op and reports nothing — which is precisely why the
 * original defect shipped with the rest of the gallery fully covered.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Gallery, { type GalleryImage } from './Gallery';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, fill, priority, ...rest }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src as string} alt={alt as string} {...(rest as Record<string, unknown>)} />
  ),
}));

const makeImages = (count: number): GalleryImage[] =>
  Array.from({ length: count }, (_, i) => ({
    src: `/img-${i}.jpg`,
    alt: `Roav bumper image ${i + 1}`,
  }));

/** Slide width in the fake layout. Slides are full-bleed, so this is also the viewport. */
const SLIDE = 300;

interface FakeEntry {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
}

/** The strip's observer callback and the slide nodes it is watching. */
let notify: ((entries: FakeEntry[]) => void) | null = null;
let slides: Element[] = [];
/** Where the compositor currently has the strip. */
let scrollLeft = 0;

const realIntersectionObserver = global.IntersectionObserver;
const realScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
const realScrollTo = (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;

beforeEach(() => {
  notify = null;
  slides = [];
  scrollLeft = 0;

  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));

  class ControllableObserver {
    constructor(callback: (entries: FakeEntry[]) => void, options?: { root?: Element | null }) {
      // Only the snap pager passes a `root`; framer-motion's viewport observers
      // do not, and must not capture the handle these tests drive.
      if (options?.root) notify = callback;
    }
    observe(node: Element) {
      slides.push(node);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    ControllableObserver;

  // jsdom has no layout: without these, every offset reads 0 and the hook's
  // "am I already there?" arithmetic trivially answers yes.
  jest.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    const parent = this.parentElement;
    return parent ? Array.prototype.indexOf.call(parent.children, this) * SLIDE : 0;
  });
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  // Sink for every scroller on the page; individual tests re-stub the one they
  // are asserting on, so the thumbnail rail's own scrolling is never counted.
  (Element.prototype as unknown as { scrollTo: unknown }).scrollTo = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  global.IntersectionObserver = realIntersectionObserver;
  if (realScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', realScrollLeft);
  (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo = realScrollTo;
});

/** Renders the gallery and returns the strip with its own `scrollTo` spy. */
function renderCarousel(count: number) {
  render(<Gallery images={makeImages(count)} name="Roav bumper" />);
  const strip = screen
    .getByTestId('gallery-carousel')
    .querySelector('[aria-roledescription="carousel"]')!;
  // The spy also MOVES the strip. A recording-only stub would leave
  // `scrollLeft` frozen at wherever the last swipe left it, and the hook's
  // already-in-place check would then wrongly skip a later real scroll — a
  // harness artefact that looks exactly like a bug in the code under test.
  const scrollTo = jest.fn((options: ScrollToOptions) => {
    scrollLeft = options.left ?? scrollLeft;
  });
  (strip as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
  return { strip, scrollTo };
}

/** The compositor moves the strip and the observer reports the slide now in front. */
function scrollTo(offset: number, index: number, ratio = 0.6) {
  scrollLeft = offset;
  act(() => {
    notify!([{ target: slides[index], isIntersecting: true, intersectionRatio: ratio }]);
  });
}

const counter = () => within(screen.getByTestId('gallery-carousel')).getByText(/^\d+ \/ \d+$/).textContent;

describe('touch carousel', () => {
  it('never commands the strip while the customer is swiping it', () => {
    // Regression: the offset check read a half-finished swipe as an external
    // change and fired `scrollTo({behavior:'smooth'})` under the finger.
    const { strip, scrollTo: stripScrollTo } = renderCarousel(4);

    fireEvent.touchStart(strip);
    scrollTo(190, 1, 0.63); // mid-drag toward slide 2, not yet settled

    expect(counter()).toBe('2 / 4');
    expect(stripScrollTo).not.toHaveBeenCalled();
  });

  it('lets a multi-slide fling run to its own resting place', () => {
    // Regression: the spurious scroll above also armed the pending guard, which
    // then swallowed every later slide report — the photo kept flying while the
    // counter and dots sat frozen for up to the 1200ms safety timeout.
    const { strip, scrollTo: stripScrollTo } = renderCarousel(4);

    fireEvent.touchStart(strip);
    fireEvent.touchEnd(strip); // flick released; momentum carries the rest

    scrollTo(380, 1);
    scrollTo(680, 2);
    scrollTo(900, 3, 0.95);

    expect(counter()).toBe('4 / 4');
    expect(stripScrollTo).not.toHaveBeenCalled();
  });

  it('reports the very first swipe on a freshly mounted gallery', () => {
    // The mount effect positions the strip at the active slide, which on the
    // ordinary "opens at image 1" path is a scroll from 0 to 0. Arming the
    // in-flight guard for a scroll that moves nothing left the pager deaf for
    // the full 1200ms safety timeout, so an early swipe moved the photo while
    // the counter and dots stayed on image 1.
    const { scrollTo: stripScrollTo } = renderCarousel(4);

    scrollTo(1 * SLIDE, 1, 0.99); // no touchStart first: nothing has released a guard

    expect(counter()).toBe('2 / 4');
    expect(stripScrollTo).not.toHaveBeenCalled();
  });

  it('still drives the strip when a thumbnail is tapped', () => {
    // The other direction: an index change the strip did NOT originate must
    // move it, or the rail and the photo disagree.
    const { scrollTo: stripScrollTo } = renderCarousel(6);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 5 of 6' }));

    expect(stripScrollTo).toHaveBeenCalledWith({ left: 4 * SLIDE, behavior: 'smooth' });
  });

  it('drives the strip back to a slide the customer had swiped to earlier', () => {
    // Guards the new origin tracking against staleness: having reported slide 2
    // once must not make a later external request for slide 2 a no-op.
    const { strip, scrollTo: stripScrollTo } = renderCarousel(6);

    fireEvent.touchStart(strip);
    scrollTo(2 * SLIDE, 2, 0.99); // customer swipes to slide 3 themselves
    expect(stripScrollTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show image 1 of 6' }));
    expect(stripScrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
    stripScrollTo.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Show image 3 of 6' }));
    expect(stripScrollTo).toHaveBeenCalledWith({ left: 2 * SLIDE, behavior: 'smooth' });
  });

  it('does not let a slide passed in transit hijack a programmatic jump', () => {
    // The reason the pending guard exists, pinned so the fix above cannot
    // regress it: every slide between here and slide 6 crosses 50% on the way,
    // and reporting one would retarget the animation to it.
    const { scrollTo: stripScrollTo } = renderCarousel(6);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 6 of 6' }));
    expect(stripScrollTo).toHaveBeenCalledTimes(1);
    stripScrollTo.mockClear();

    scrollTo(1 * SLIDE, 1); // slide 2 sweeps past mid-animation
    scrollTo(3 * SLIDE, 3);

    expect(counter()).toBe('6 / 6');
    expect(stripScrollTo).not.toHaveBeenCalled();
  });

  it('hands control back the moment the customer touches a jump in flight', () => {
    const { strip, scrollTo: stripScrollTo } = renderCarousel(6);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 6 of 6' }));
    stripScrollTo.mockClear();

    fireEvent.touchStart(strip); // grab the moving strip
    scrollTo(2 * SLIDE, 2, 0.99);

    expect(counter()).toBe('3 / 6');
    expect(stripScrollTo).not.toHaveBeenCalled();
  });
});
