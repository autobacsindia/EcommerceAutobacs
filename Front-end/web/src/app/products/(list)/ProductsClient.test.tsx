/**
 * Product listing (client half of /products).
 *
 * page.tsx is a Server Component that fetches the first page and hands it to
 * ProductsClient as `initialData` + `initialParams`. These tests cover the client:
 * the server seed is used only when its params match the URL, the list otherwise
 * comes from the API through TanStack Query, and loading / empty / error / sort
 * all behave.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders, createTestQueryClient } from '@/test-utils/renderWithProviders';
import ProductsClient from './ProductsClient';
import apiClient from '@/lib/api';
import { trackViewItemList } from '@/lib/analytics';
import type { ProductsData } from '@/lib/productQuery';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { __esModule: true, ...actual, default: { get: jest.fn() } };
});

let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), refresh: mockRefresh }),
  usePathname: () => '/products',
}));

jest.mock('@/lib/analytics', () => ({ trackViewItemList: jest.fn() }));

// Campaign badges are a separate concern with their own tests.
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({
  useCampaignProductRates: () => ({ data: undefined }),
}));
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaignBadgeVisible: () => false,
}));

// Presentational children, stubbed to keep this about the listing logic.
jest.mock('@/components/products/redesign/StoreProductCard', () => ({
  __esModule: true,
  default: ({ product }: { product: { name: string } }) => <div data-testid="product-card">{product.name}</div>,
}));
jest.mock('@/components/products/redesign/Filters', () => ({ __esModule: true, default: () => <div data-testid="filters" /> }));
jest.mock('@/components/products/redesign/CategoryChips', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/products/redesign/ActiveFilters', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/products/ShopContactHero', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/layout/Pagination', () => ({ __esModule: true, default: () => <div data-testid="pagination" /> }));
jest.mock('@/components/ui/Reveal', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const products = [
  { _id: 'p1', name: 'Test Product 1', price: 100, images: [], stock: 'in', isActive: true },
  { _id: 'p2', name: 'Test Product 2', price: 200, images: [], stock: 'in', isActive: true },
];
const apiPage = { products, total: 2, pages: 1, currentPage: 1, count: 2 };
const get = apiClient.get as jest.Mock;

describe('ProductsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    get.mockResolvedValue(apiPage);
  });

  it('shows a loading state, then the products from the API', async () => {
    renderWithProviders(<ProductsClient />);

    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);

    expect(await screen.findByText('Test Product 1')).toBeInTheDocument();
    expect(screen.getByText('Test Product 2')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/products\?/));
  });

  it('paints the server-rendered page without a client fetch when params match', () => {
    const initialData: ProductsData = {
      products: products as unknown as ProductsData['products'],
      pagination: { total: 2, pages: 1, currentPage: 1 } as ProductsData['pagination'],
    };

    // Production's 60s staleTime: the seed (backdated ~30s) is still fresh. The test
    // client's staleTime 0 would trigger an immediate background refetch instead.
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, staleTime: 60_000 } });
    renderWithProviders(<ProductsClient initialData={initialData} initialParams={{}} />, { queryClient });

    // Synchronously present: no spinner, no request.
    expect(screen.getByText('Test Product 1')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('ignores the server page when the URL params differ from what the server fetched', async () => {
    mockSearchParams = new URLSearchParams('sort=price_asc');
    const stale: ProductsData = {
      products: [{ ...products[0], name: 'Server Page Product' }] as unknown as ProductsData['products'],
      pagination: { total: 1 } as ProductsData['pagination'],
    };

    renderWithProviders(<ProductsClient initialData={stale} initialParams={{}} />);

    expect(await screen.findByText('Test Product 1')).toBeInTheDocument();
    expect(screen.queryByText('Server Page Product')).not.toBeInTheDocument();
    // The URL's sort=price_asc is translated to the API's sortBy/order pair.
    expect(get).toHaveBeenCalledWith(expect.stringContaining('sortBy=price&order=asc'));
  });

  it('shows the empty state when nothing matches', async () => {
    get.mockResolvedValue({ products: [], total: 0, pages: 0, currentPage: 1, count: 0 });

    renderWithProviders(<ProductsClient />);

    expect(await screen.findByText('No products match your filters')).toBeInTheDocument();
    expect(screen.queryByTestId('product-card')).not.toBeInTheDocument();
  });

  it('shows the fetch error and no grid when the API fails', async () => {
    get.mockRejectedValue(new Error('Boom'));

    renderWithProviders(<ProductsClient />);

    // ProductFetchError offers a refresh; the raw message is dev-only.
    expect(await screen.findByRole('button', { name: 'Refresh Page' })).toBeInTheDocument();
    expect(screen.queryByTestId('product-card')).not.toBeInTheDocument();
    expect(screen.queryByText('No products match your filters')).not.toBeInTheDocument();
  });

  it('changing the sort rewrites the URL and drops the page number', async () => {
    mockSearchParams = new URLSearchParams('page=3');
    renderWithProviders(<ProductsClient />);
    await screen.findByText('Test Product 1');

    fireEvent.change(screen.getByLabelText('Sort products'), { target: { value: 'price_asc' } });

    expect(mockReplace).toHaveBeenCalledWith('/products?sort=price_asc', { scroll: false });
  });

  it('reports the list view to analytics once, with the real item count', async () => {
    mockSearchParams = new URLSearchParams('sort=price_asc');
    renderWithProviders(<ProductsClient />);
    await screen.findByText('Test Product 1');

    await waitFor(() => expect(trackViewItemList).toHaveBeenCalledTimes(1));
    expect(trackViewItemList).toHaveBeenCalledWith({ listType: 'all', listName: undefined, itemCount: 2 });
  });

  // Regression: the de-dupe ref used to start as '', which a bare /products URL also
  // serialises to, so the most common visit was treated as "already tracked".
  it('reports the list view on a bare /products visit (no query string)', async () => {
    renderWithProviders(<ProductsClient />);
    await screen.findByText('Test Product 1');

    await waitFor(() => expect(trackViewItemList).toHaveBeenCalledTimes(1));
  });
});
