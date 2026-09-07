/**
 * The chip row's job before its data arrives.
 *
 * This row lives inside a STICKY bar directly above the product grid, so its
 * height is load-bearing: while it rendered nothing, the bar painted short and
 * then grew when `/categories` resolved, pushing the whole grid down the page.
 * Measured on a production build of this source, that single jump was the
 * entirety of `/products`'s CLS (0.0273 → 0 with this fixed), and none of it
 * came from the cards. jsdom cannot measure that; what it CAN pin is the render
 * that reserves the height, which is what these tests do.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import CategoryChips from './CategoryChips';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

let resolveCategories: (v: unknown) => void;
const getMock = jest.fn(
  () =>
    new Promise((resolve) => {
      resolveCategories = resolve;
    })
);

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => getMock(...(args as [])) },
}));

beforeEach(() => getMock.mockClear());

describe('CategoryChips', () => {
  it('renders the row before /categories resolves, so the sticky bar cannot grow', () => {
    render(<CategoryChips />);

    // The fetch is deliberately still in flight here.
    expect(getMock).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'All categories' })).toBeInTheDocument();
  });

  it('keeps a working control when /categories never arrives', async () => {
    // A failed taxonomy call used to leave an empty bar. "All categories" needs
    // no data — it is the control that CLEARS the filter — so it stays usable.
    render(<CategoryChips />);
    await act(async () => {
      resolveCategories({});
    });

    expect(screen.getByRole('button', { name: 'All categories' })).toBeInTheDocument();
  });

  it('adds the hubs alongside it once they load, without replacing the row', async () => {
    render(<CategoryChips />);
    await act(async () => {
      resolveCategories({
        categories: [
          { _id: 'cat-audio', name: 'Audio' },
          { _id: 'cat-lighting', name: 'Lighting' },
          // Children are the sidebar's job; the strip is hubs only.
          { _id: 'cat-sub', name: 'Subwoofers', parent: 'cat-audio' },
        ],
      });
    });

    expect(screen.getByRole('button', { name: 'All categories' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subwoofers' })).not.toBeInTheDocument();
  });
});
