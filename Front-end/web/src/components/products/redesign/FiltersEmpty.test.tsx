/**
 * The filter panel's "nothing matches" box.
 *
 * It offers "Clear all filters", so it belongs only where a filter is on — a
 * search for a part we do not stock showed it with no filter set at all. And
 * clearing must clear the FILTERS: pushing the bare base path also dropped the
 * search page's `q`, so the shopper lost what they had typed.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

let currentUrl = '/products/search?q=led';
const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  usePathname: () => currentUrl.split('?')[0],
  useSearchParams: () => new URLSearchParams(currentUrl.split('?')[1] ?? ''),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n}` }),
}));

const EMPTY_FACETS = {
  total: 0,
  brands: [],
  categories: [],
  vehicleMakes: [],
  vehicleModels: [],
  price: { min: 0, max: 0, selectedMin: null, selectedMax: null, histogram: [] },
  ratings: [],
  availability: [],
};

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (path: string) => (path.startsWith('/products/facets') ? { facets: EMPTY_FACETS } : {})),
  },
}));

jest.mock('@/components/ui/PriceHistogram', () => ({ __esModule: true, default: () => <div /> }));

import Filters from './Filters';

async function mount() {
  render(<Filters basePath="/products/search" />);
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => push.mockClear());

it('says nothing about filters when none is set', async () => {
  currentUrl = '/products/search?q=zzqqxx';
  await mount();
  expect(screen.queryByText(/No products match every filter/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Clear all filters/ })).toBeNull();
});

it('clears the filters but keeps the search term and the sort', async () => {
  currentUrl = '/products/search?q=led&sort=price_asc&brand=Lightforce&inStock=true&page=2';
  await mount();
  fireEvent.click(await screen.findByRole('button', { name: /Clear all filters/ }));
  expect(push).toHaveBeenCalledWith('/products/search?q=led&sort=price_asc', { scroll: false });
});
