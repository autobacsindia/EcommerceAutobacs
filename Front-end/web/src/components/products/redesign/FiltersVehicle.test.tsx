/**
 * The My Vehicle group: what the make and model counts MEAN.
 *
 * A make and its models are two levels of the SAME overlapping set, not a total
 * and its parts. On prod, 10 of BMW's 39 products fit more than one BMW model
 * (two fit all four), so the model rows read 21/20/12/6 — summing to 59 — beside
 * a make reading 39. That looked like an arithmetic error to everyone who saw it,
 * and the previous "fix" was to make the make read 59, which broke the one
 * property a facet count must have: it equals what you get when you click it.
 *
 * So the counts stay correct and the LABEL carries the meaning: "21 of 39".
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let currentUrl = '/products';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => currentUrl.split('?')[0],
  useSearchParams: () => new URLSearchParams(currentUrl.split('?')[1] ?? ''),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n}` }),
}));

/** The real prod shape: models sum to 59, the make is 39. */
const FACETS = {
  total: 39,
  brands: [],
  categories: [],
  vehicleMakes: [
    { value: 'BMW', count: 39, selected: true },
    { value: 'Toyota', count: 255, selected: false },
  ],
  vehicleModels: [
    { value: '5 Series', make: 'BMW', count: 21, selected: false },
    { value: '3 series', make: 'BMW', count: 20, selected: false },
    { value: 'X Series', make: 'BMW', count: 12, selected: false },
    { value: '7 series', make: 'BMW', count: 6, selected: false },
  ],
  price: { min: 100, max: 10000, selectedMin: null, selectedMax: null, histogram: [] },
  ratings: [],
  availability: [],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (path: string) =>
      (path.startsWith('/products/facets') ? { facets: FACETS } : {})),
  },
}));

jest.mock('@/components/ui/PriceHistogram', () => ({
  __esModule: true,
  default: () => <div />,
}));

import Filters from './Filters';

async function mount() {
  const view = render(<Filters />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

const modelOptions = () =>
  Array.from(
    (screen.getByLabelText('Vehicle model') as HTMLSelectElement).options
  ).map((o) => o.textContent!.replace(/\s+/g, ' ').trim());

describe('My Vehicle — model counts name their denominator', () => {
  it('renders "21 of 39", so the rows cannot be read as parts of a total', async () => {
    currentUrl = '/products?vehicleMake=BMW';
    await mount();

    expect(modelOptions()).toEqual(expect.arrayContaining([
      '5 Series (21 of 39)',
      '3 series (20 of 39)',
      'X Series (12 of 39)',
      '7 series (6 of 39)',
    ]));
  });

  it('finds the denominator when the URL spells the make in lowercase', async () => {
    // ?vehicleMake=bmw filters perfectly well — the backend's vehicle index is
    // keyed on lowercase. An exact-match lookup here would silently fall back to
    // bare counts for a working filter, which is the same trap that emptied this
    // dropdown server-side.
    currentUrl = '/products?vehicleMake=bmw';
    await mount();

    expect(modelOptions()).toContain('5 Series (21 of 39)');
  });

  it('falls back to a bare count when no single make owns the denominator', async () => {
    // A multi-make URL has no one total to be "of".
    currentUrl = '/products?vehicleMake=BMW,Toyota';
    await mount();

    expect(modelOptions()).toContain('5 Series (21)');
    expect(modelOptions().join(' ')).not.toContain(' of ');
  });

  it('still shows the make count as distinct products, not the model sum', async () => {
    // The regression guard: 59 here means the double-count is back.
    currentUrl = '/products?vehicleMake=BMW';
    await mount();

    const makeOptions = Array.from(
      (screen.getByLabelText('Vehicle make') as HTMLSelectElement).options
    ).map((o) => o.textContent!.trim());
    expect(makeOptions).toContain('BMW (39)');
    expect(makeOptions.join(' ')).not.toContain('59');
  });
});
