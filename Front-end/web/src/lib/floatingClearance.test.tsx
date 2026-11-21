/**
 * The product page's buy buttons tell the floating Contact button where not to
 * sit. These cover the reporting side: the in-page buy block (IntersectionObserver)
 * and the sticky buy bar (its own height), including unmount and hide.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import {
  resetFloatingClearance,
  setBuyButtonsInView,
  useFloatingClearance,
  useKeepFloatingButtonsClear,
  useReportBuyBarHeight,
  type FloatingClearance,
} from './floatingClearance';

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let ioCallbacks: IOCallback[] = [];
const disconnect = jest.fn();

beforeEach(() => {
  ioCallbacks = [];
  disconnect.mockClear();
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: IOCallback) { ioCallbacks.push(cb); }
    observe() {}
    disconnect() { disconnect(); }
  };
  act(() => resetFloatingClearance());
});

let seen: FloatingClearance;
function Reader() {
  seen = useFloatingClearance();
  return null;
}

function BuyBlock() {
  const ref = useKeepFloatingButtonsClear<HTMLDivElement>();
  return <div ref={ref}>Add to cart</div>;
}

function Bar({ shown, height }: { shown: boolean; height: number }) {
  const ref = useReportBuyBarHeight<HTMLDivElement>(shown);
  if (!shown) return null;
  return (
    <div
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
        ref.current = el;
      }}
    />
  );
}

describe('buy block in view', () => {
  it('reports while on screen and clears when scrolled away', () => {
    render(<><Reader /><BuyBlock /></>);
    expect(seen.buyButtonsInView).toBe(false);
    act(() => ioCallbacks[0]([{ isIntersecting: true }]));
    expect(seen.buyButtonsInView).toBe(true);
    act(() => ioCallbacks[0]([{ isIntersecting: false }]));
    expect(seen.buyButtonsInView).toBe(false);
  });

  it('clears when the block unmounts (navigating away mid-view)', () => {
    const { rerender } = render(<><Reader /><BuyBlock /></>);
    act(() => ioCallbacks[0]([{ isIntersecting: true }]));
    rerender(<Reader />);
    expect(disconnect).toHaveBeenCalled();
    expect(seen.buyButtonsInView).toBe(false);
  });

  it('stays "in view" while any one of several blocks is on screen', () => {
    render(<Reader />);
    const a = {};
    const b = {};
    act(() => { setBuyButtonsInView(a, true); setBuyButtonsInView(b, true); });
    act(() => setBuyButtonsInView(a, false));
    expect(seen.buyButtonsInView).toBe(true);
    act(() => setBuyButtonsInView(b, false));
    expect(seen.buyButtonsInView).toBe(false);
  });

  it('does nothing where IntersectionObserver is missing', () => {
    delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    expect(() => render(<><Reader /><BuyBlock /></>)).not.toThrow();
    expect(seen.buyButtonsInView).toBe(false);
  });
});

describe('sticky buy bar height', () => {
  it('reports the bar height while it shows and 0 once it hides', () => {
    const { rerender } = render(<><Reader /><Bar shown={false} height={117} /></>);
    expect(seen.buyBarHeight).toBe(0);
    rerender(<><Reader /><Bar shown height={117} /></>);
    expect(seen.buyBarHeight).toBe(117);
    rerender(<><Reader /><Bar shown={false} height={117} /></>);
    expect(seen.buyBarHeight).toBe(0);
  });

  it('reports 0 when the bar unmounts with the page', () => {
    const { rerender } = render(<><Reader /><Bar shown height={88} /></>);
    expect(seen.buyBarHeight).toBe(88);
    rerender(<Reader />);
    expect(seen.buyBarHeight).toBe(0);
  });
});
