/**
 * The category page must arrive WITH its first page of products.
 *
 * It reads useSearchParams(), so a statically generated route bailed out to client
 * rendering: the server HTML held an empty <div>, and the page's largest image
 * could not be requested until the bundle had loaded and made its own API call
 * (Lighthouse: ~8 s simulated, ~21 s throttled). The Suspense fallback is now the
 * default view itself, seeded with the products page.tsx fetched.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

let params = new URLSearchParams();
let urlUnreadable = false;
jest.mock('next/navigation', () => ({
  usePathname: () => '/categories/audio',
  useSearchParams: () => {
    // What a static prerender does: the URL cannot be read, so the boundary falls back.
    if (urlUnreadable) throw new Promise(() => {});
    return params;
  },
}));

let resolveProducts: (body: unknown) => void;
const apiGet = jest.fn((path: string) => {
  if (path.startsWith('/categories')) return Promise.resolve({ categories: [], pagination: { pages: 1 } });
  return new Promise((resolve) => { resolveProducts = resolve; });
});
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (p: string) => apiGet(p) } }));

jest.mock('@/components/products/ProductGrid', () => ({
  __esModule: true,
  default: ({ products }: { products: Array<{ name: string }> }) => (
    <div data-testid="grid">{products.map((p) => p.name).join(',')}</div>
  ),
}));
jest.mock('@/components/products/redesign/Filters', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/redesign/CategoryChips', () => ({
  __esModule: true,
  default: () => <div />,
  CategoryChipsFallback: () => <div />,
}));
jest.mock('@/components/layout/Pagination', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/lib/analytics', () => ({ trackViewItemList: jest.fn() }));

import ClientPage from './ClientPage';

const HUB = { _id: 'hub-audio', name: 'Audio', slug: 'audio', isActive: true, order: 1 };
const SERVER_PAGE = {
  products: [{ _id: 'a', name: 'Subwoofer' }, { _id: 'b', name: 'Amplifier' }],
  pagination: { total: 2, pages: 1, currentPage: 1 },
};

const renderPage = (initialProducts: unknown = SERVER_PAGE) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <ClientPage slug="audio" initialCategory={HUB as never} initialProducts={initialProducts as never} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  params = new URLSearchParams();
  urlUnreadable = false;
  apiGet.mockClear();
});

it('renders the heading and the first page of products before the URL can be read', () => {
  urlUnreadable = true;
  renderPage();

  expect(screen.getByRole('heading', { name: 'Audio' })).toBeInTheDocument();
  expect(screen.getByTestId('grid')).toHaveTextContent('Subwoofer,Amplifier');
  expect(screen.queryByText('Loading products…')).not.toBeInTheDocument();
});

it('keeps the pre-rendered grid on screen while it refreshes — no skeleton flash', async () => {
  renderPage();
  expect(screen.getByTestId('grid')).toHaveTextContent('Subwoofer,Amplifier');
  expect(screen.queryByText('Loading products…')).not.toBeInTheDocument();

  // The refresh still runs: the server copy may be minutes old, live prices win.
  await act(async () => {});
  expect(apiGet).toHaveBeenCalledWith('/products?category=hub-audio');
  await act(async () => {
    resolveProducts({ products: [{ _id: 'a', name: 'Subwoofer (live)' }], total: 1 });
  });
  expect(screen.getByTestId('grid')).toHaveTextContent('Subwoofer (live)');
});

it('does not show the default grid for a sorted or filtered link', async () => {
  params = new URLSearchParams('sort=price_asc');
  renderPage();
  expect(screen.getByText('Loading products…')).toBeInTheDocument();
  expect(screen.queryByTestId('grid')).not.toBeInTheDocument();

  await act(async () => {});
  expect(apiGet).toHaveBeenCalledWith('/products?category=hub-audio&sortBy=price&order=asc');
});

it('still uses the pre-rendered grid for an ad click (tracking params only)', () => {
  params = new URLSearchParams('utm_source=google&gclid=abc');
  renderPage();
  expect(screen.getByTestId('grid')).toHaveTextContent('Subwoofer,Amplifier');
});

it('falls back to loading in the browser when the server could not fetch products', () => {
  renderPage(null);
  expect(screen.getByText('Loading products…')).toBeInTheDocument();
});
