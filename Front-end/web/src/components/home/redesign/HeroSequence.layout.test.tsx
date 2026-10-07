/**
 * HeroSequence's two layout guarantees, rendered:
 *   - the pinned-layout class is on the wrapper BEFORE paint (layout effect), on any
 *     device that will run the sequence — and absent on one that opts out;
 *   - if frame 0 can never arrive, the wrapper falls back to the stacked hero rather
 *     than keep a tall pin over a still photo.
 */
import React, { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import HeroSequence, { LAYOUT_CLASS, ACTIVE_CLASS, useHeroLayoutClass } from './HeroSequence';

jest.mock('./Img', () => ({ __esModule: true, default: (p: { className?: string }) => <img alt="" className={p.className} /> }));

function setDevice({ reducedMotion = false }: { reducedMotion?: boolean } = {}) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce') ? reducedMotion : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })) as unknown as typeof window.matchMedia;
}

/** Mirrors Hero: the OWNER of the pin ref calls the hook; HeroSequence is a child. */
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useHeroLayoutClass(ref);
  return <div data-testid="pin" ref={ref}><HeroSequence sectionRef={ref} /></div>;
}

beforeAll(() => {
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} disconnect() {} };
});

afterEach(() => { jest.restoreAllMocks(); });

it('puts the pinned layout on before paint for a device that will scrub', () => {
  setDevice();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); // no canvas work
  const { getByTestId } = render(<Harness />);
  expect(getByTestId('pin').classList.contains(LAYOUT_CLASS)).toBe(true);
  // The canvas swap is a separate step — not yet, no frame has been drawn.
  expect(getByTestId('pin').classList.contains(ACTIVE_CLASS)).toBe(false);
});

it('keeps (or takes) the layout off for a device that opts out', () => {
  setDevice({ reducedMotion: true });
  const { getByTestId, container } = render(<Harness />);
  // Even if the pre-paint script had put it on, the layout effect corrects it.
  expect(getByTestId('pin').classList.contains(LAYOUT_CLASS)).toBe(false);
  expect(container.querySelector('.hero-seq-fallback')).not.toBeNull();
});

it('falls back to the stacked hero when frame 0 cannot load', async () => {
  setDevice();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ clearRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D);
  global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  const { getByTestId } = render(<Harness />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await waitFor(() => expect(getByTestId('pin').classList.contains(LAYOUT_CLASS)).toBe(false));
  expect(getByTestId('pin').classList.contains(ACTIVE_CLASS)).toBe(false);
});

it('regression: the hook does nothing when called from a CHILD of the pin (ref not yet attached)', () => {
  // Why Hero, not HeroSequence, owns the hook — child layout effects run before the
  // parent element's ref is attached.
  setDevice();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  let classAtChildLayout: boolean | null = null;
  function Child({ pinRef }: { pinRef: React.RefObject<HTMLDivElement | null> }) {
    useHeroLayoutClass(pinRef);
    React.useLayoutEffect(() => { classAtChildLayout = !!pinRef.current?.classList.contains(LAYOUT_CLASS); }, [pinRef]);
    return null;
  }
  function Parent() {
    const ref = useRef<HTMLDivElement>(null);
    return <div ref={ref}><Child pinRef={ref} /></div>;
  }
  render(<Parent />);
  expect(classAtChildLayout).toBe(false);
});
