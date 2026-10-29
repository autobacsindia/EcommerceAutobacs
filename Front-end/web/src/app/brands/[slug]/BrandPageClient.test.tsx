/**
 * The brand page must arrive WITH its first page of products — the same fix as
 * app/categories/[slug]/ClientPage.prerender.test.tsx. Reading useSearchParams()
 * made the static route bail out to client rendering, so the HTML held an empty
 * <div> and the first photo waited for the bundle and its own API call.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let params = new URLSearchParams();
let urlUnreadable = false;
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => {
    if (urlUnreadable) throw new Promise(() => {});
    return params;
  },
}));

let resolveProducts: (body: unknown) => void;
const apiGet = jest.fn((_path: string) => new Promise((resolve) => { resolveProducts = resolve; }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (p: string) => apiGet(p) } }));

jest.mock('@/components/products/ProductGrid', () => ({
  __esModule: true,
  default: ({ products }: { products: Array<{ name: string }> }) => (
    <div data-testid="grid">{products.map((p) => p.name).join(',')}</div>
  ),
}));
jest.mock('@/components/layout/Pagination', () => ({ __esModule: true, default: () => <div /> }));

import BrandPageClient from './BrandPageClient';

const BRAND = { name: 'Profender', slug: 'profender' };
const SERVER_PAGE = { products: [{ _id: 'a', name: 'Drift kit' }], pagination: { total: 15 } };

const renderPage = (initialProducts: unknown = SERVER_PAGE) =>
  render(<BrandPageClient slug="profender" initialBrand={BRAND} initialProducts={initialProducts as never} />);

beforeEach(() => {
  params = new URLSearchParams();
  urlUnreadable = false;
  apiGet.mockClear();
});

it('renders page 1 of products before the URL can be read', () => {
  urlUnreadable = true;
  renderPage();
  expect(screen.getByTestId('grid')).toHaveTextContent('Drift kit');
  expect(screen.getByText('15 products')).toBeInTheDocument();
});

it('refreshes page 1 silently, then shows the live list', async () => {
  renderPage();
  expect(screen.getByTestId('grid')).toHaveTextContent('Drift kit');
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

  await act(async () => {});
  expect(apiGet).toHaveBeenCalledWith('/products/brands/profender?page=1&limit=12');
  await act(async () => { resolveProducts({ products: [{ _id: 'a', name: 'Drift kit (live)' }], total: 15 }); });
  expect(screen.getByTestId('grid')).toHaveTextContent('Drift kit (live)');
});

it('does not show page 1 for a later page', async () => {
  params = new URLSearchParams('page=2');
  renderPage();
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  await act(async () => {});
  expect(apiGet).toHaveBeenCalledWith('/products/brands/profender?page=2&limit=12');
});

it('loads in the browser when the server could not fetch products', () => {
  renderPage(null);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
});
