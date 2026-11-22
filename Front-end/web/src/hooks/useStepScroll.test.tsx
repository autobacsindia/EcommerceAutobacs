/**
 * Checkout step changes scroll back to the top of the steps and focus the new heading
 * (the page used to stay 370–500px down at the footer after "Continue").
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useStepScroll } from './useStepScroll';

function Steps({ step }: { step: string }) {
  const { containerRef, headingRef } = useStepScroll(step);
  return (
    <div>
      <div ref={containerRef} data-testid="top" />
      <h2 ref={headingRef} tabIndex={-1}>{`Step ${step}`}</h2>
    </div>
  );
}

let scrollIntoView: jest.Mock;
const setReducedMotion = (reduced: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: reduced && q.includes('reduce'), media: q, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) as any;
};

beforeEach(() => {
  scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).scrollIntoView = scrollIntoView;
  setReducedMotion(false);
});

it('does not scroll or steal focus on first render', () => {
  render(<Steps step="cart" />);
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.body);
});

it.each([
  ['cart', 'address'], ['address', 'payment'], ['payment', 'review'], ['review', 'payment'], ['address', 'cart'],
])('%s → %s scrolls the steps into view and focuses the new heading', (from, to) => {
  const { rerender } = render(<Steps step={from} />);
  rerender(<Steps step={to} />);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('top'));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: `Step ${to}` }));
});

it('reduced motion → jumps instead of smooth-scrolling', () => {
  setReducedMotion(true);
  const { rerender } = render(<Steps step="cart" />);
  rerender(<Steps step="address" />);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
});

it('a re-render on the same step does nothing', () => {
  const { rerender } = render(<Steps step="cart" />);
  rerender(<Steps step="cart" />);
  expect(scrollIntoView).not.toHaveBeenCalled();
});
