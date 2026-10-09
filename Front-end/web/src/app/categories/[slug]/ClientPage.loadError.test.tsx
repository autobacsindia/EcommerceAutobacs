/**
 * A failed product load is not an empty category.
 *
 * The grid used to swallow every error and render "No products found in this
 * category" — on a dropped mobile connection a customer was told a full category
 * was empty, with nothing to do but leave. Now a genuine 404 still reads as empty,
 * while any other failure shows a retry that loads the products.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

const searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  usePathname: () => '/categories/audio',
  useSearchParams: () => searchParams,
}));

let productsResponse: () => Promise<unknown>;
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn((path: string) => {
      if (path.startsWith('/categories')) {
        return Promise.resolve({ categories: [{ _id: 'hub-audio', name: 'Audio', slug: 'audio' }], pagination: { pages: 1 } });
      }
      return productsResponse();
    }),
  },
}));

jest.mock('@/components/products/ProductGrid', () => ({
  __esModule: true,
  default: ({ products }: { products: Array<{ name: string }> }) => (
    <div data-testid="grid">{products.map((p) => p.name).join(',')}</div>
  ),
}));
jest.mock('@/components/products/redesign/Filters', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/redesign/CategoryChips', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/layout/Breadcrumb', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/layout/Pagination', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/lib/analytics', () => ({ trackViewItemList: jest.fn() }));

import ClientPage from './ClientPage';

const HUB = { _id: 'hub-audio', name: 'Audio', slug: 'audio', isActive: true, order: 1 };

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <ClientPage slug="audio" initialCategory={HUB as never} />
    </QueryClientProvider>,
  );

const networkError = () => Promise.reject(Object.assign(new Error('Failed to fetch'), { status: 0 }));
const products = (...names: string[]) => () =>
  Promise.resolve({ products: names.map((n) => ({ _id: n, name: n, images: [], price: 1 })), total: names.length });

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { (console.error as jest.Mock).mockRestore(); });

it('offers a retry — not "no products" — when the products could not be loaded', async () => {
  productsResponse = networkError;
  renderPage();

  expect(await screen.findByText(/couldn.t load products right now/i)).toBeInTheDocument();
  expect(screen.queryByText('No products in this category yet')).not.toBeInTheDocument();

  productsResponse = products('Subwoofer', 'Amplifier');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('grid')).toHaveTextContent('Subwoofer,Amplifier');
});

it('still says the category is empty when the API answers 404', async () => {
  productsResponse = () => Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
  renderPage();
  expect(await screen.findByText('No products in this category yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});
