/**
 * useOfferProducts — the `/offers` page's paginated fetch.
 * Verifies the page number reaches the URL and distinct pages get distinct cache keys
 * (the bug the backend fix in this same change addresses: pages must never collide).
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOfferProducts } from './useOfferProducts';

const getMock = jest.fn();
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => getMock(...a) },
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({
    success: true,
    products: [{ _id: 'p1' }],
    total: 1,
    pages: 1,
    currentPage: 1,
    hasNext: false,
    hasPrev: false,
  });
});

describe('useOfferProducts', () => {
  it('requests the given page at the standard page size', async () => {
    const { result } = renderHook(() => useOfferProducts(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getMock).toHaveBeenCalledWith('/products/offers?page=1&limit=24');
    expect(result.current.data?.products).toHaveLength(1);
  });

  it('gives page 2 a distinct cache entry from page 1 (no data collision across pages)', async () => {
    const w = wrapper();
    const page1 = renderHook(() => useOfferProducts(1), { wrapper: w });
    await waitFor(() => expect(page1.result.current.isSuccess).toBe(true));

    const page2 = renderHook(() => useOfferProducts(2), { wrapper: w });
    await waitFor(() => expect(page2.result.current.isSuccess).toBe(true));

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenNthCalledWith(1, '/products/offers?page=1&limit=24');
    expect(getMock).toHaveBeenNthCalledWith(2, '/products/offers?page=2&limit=24');
  });
});
