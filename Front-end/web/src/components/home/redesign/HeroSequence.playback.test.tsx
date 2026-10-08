/**
 * The hero animation plays ONCE on a clock and never touches page scrolling.
 *
 * It used to scrub frames against scroll inside a 300vh sticky track, which froze
 * the page under the visitor's scroll. These tests pin the replacement: no scroll
 * listener, time-driven playback that comes apart, holds, and reassembles to rest on
 * the complete car (frame 0), buffering on a frame
 * that has not arrived, and stepping over one that failed.
 */
import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import HeroSequence, { useHeroLayoutClass, ACTIVE_CLASS } from './HeroSequence';
import { heroSequenceMobile } from './homeContent';

jest.mock('./Img', () => ({ __esModule: true, default: (p: { className?: string }) => <img alt="" className={p.className} /> }));

// ── controllable clock + rAF ─────────────────────────────────────────────────
let now = 0;
let rafQueue: Array<(t: number) => void> = [];
const advance = async (ms: number) => {
  // Step in 10ms slices so rAF callbacks run at a realistic cadence.
  for (let t = 0; t < ms; t += 10) {
    now += 10;
    const q = rafQueue; rafQueue = [];
    q.forEach((cb) => cb(now));
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { jest.advanceTimersByTime(10); });
  }
};

const drawn: number[] = [];
let failIndex = -1;
let holdIndex = -1;
let releaseHold: (() => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  now = 0; rafQueue = []; drawn.length = 0; failIndex = -1; holdIndex = -1; releaseHold = null;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  global.requestAnimationFrame = ((cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length; }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = (() => { rafQueue = []; }) as typeof cancelAnimationFrame;
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    cb: (e: Array<{ isIntersecting: boolean }>) => void;
    constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) { this.cb = cb; }
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
  };
  // Each frame "decodes" to a bitmap that remembers its index.
  global.fetch = jest.fn((url: string) => {
    const i = Number(/(\d+)\.\w+$/.exec(url)![1]) - 1;
    if (i === failIndex) return Promise.resolve({ ok: false, status: 404 });
    const ok = { ok: true, blob: async () => ({ i }) };
    if (i === holdIndex) return new Promise((res) => { releaseHold = () => res(ok); });
    return Promise.resolve(ok);
  }) as unknown as typeof fetch;
  (global as unknown as { createImageBitmap: unknown }).createImageBitmap = async (b: { i: number }) => ({ width: 720, height: 404, close() {}, i: b.i });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect() {},
    drawImage(img: { i: number }) { drawn.push(img.i); },
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
});

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useHeroLayoutClass(ref);
  return <div data-testid="pin" ref={ref}><HeroSequence sectionRef={ref} /></div>;
}

const last = heroSequenceMobile.count - 1;

it('never listens to page scroll', async () => {
  const add = jest.spyOn(window, 'addEventListener');
  render(<Harness />);
  await advance(50);
  expect(add.mock.calls.map((c) => c[0])).not.toContain('scroll');
});

it('comes apart, holds on the exploded build, then reassembles and rests on the complete car', async () => {
  const { getByTestId } = render(<Harness />);
  await advance(9000); // mobile: 49 frames forward + 49 back at 16fps ≈ 6s, + hold + start delay
  expect(getByTestId('pin').classList.contains(ACTIVE_CLASS)).toBe(true);
  const peak = drawn.indexOf(last);
  expect(peak).toBeGreaterThan(0);
  // Forward to the exploded frame, in order...
  for (let k = 1; k <= peak; k++) expect(drawn[k]).toBeGreaterThanOrEqual(drawn[k - 1]);
  // ...then back, in order, ending on the complete car.
  for (let k = peak + 1; k < drawn.length; k++) expect(drawn[k]).toBeLessThanOrEqual(drawn[k - 1]);
  expect(drawn[drawn.length - 1]).toBe(0);
  // Finished: no more animation frames requested, nothing more drawn.
  const before = drawn.length;
  await advance(1000);
  expect(drawn.length).toBe(before);
  expect(rafQueue).toHaveLength(0);
});

it('waits for a frame that has not arrived instead of skipping to a blank', async () => {
  holdIndex = 10;
  render(<Harness />);
  await advance(4000);
  expect(Math.max(...drawn)).toBe(9); // held at the frame before the missing one
  await act(async () => { releaseHold!(); });
  await advance(9000);
  expect(drawn).toContain(10);
  expect(drawn).toContain(last);
  expect(drawn[drawn.length - 1]).toBe(0);
});

it('steps over a frame that failed for good', async () => {
  failIndex = 20;
  render(<Harness />);
  await advance(9000);
  expect(drawn).not.toContain(20);
  expect(drawn).toContain(last);
  expect(drawn[drawn.length - 1]).toBe(0);
});
