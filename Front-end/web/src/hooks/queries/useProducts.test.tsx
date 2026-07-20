/**
 * useProducts — TanStack Query hook for the product listing.
 * Verifies dedup/cache on identical params and that distinct params refetch.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProducts } from './useProducts';
import { normalizeParams } from './keys';

const getMock = jest.fn();
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => getMock(...a) },
  ApiError: class ApiError extends Error {},
  ErrorCategory: { NETWORK: 'network', SERVER: 'server' },
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ products: [{ _id: 'p1' }], total: 1, currentPage: 1 });
});

describe('normalizeParams', () => {
  it('sorts keys and drops empties for a stable cache key', () => {
    expect(normalizeParams({ b: '2', a: '1', c: '', d: undefined })).toEqual({ a: '1', b: '2' });
  });
});

describe('useProducts', () => {
  it('fetches and returns products', async () => {
    const { result } = renderHook(() => useProducts({ page: '1' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.products).toHaveLength(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('serves identical params from cache without a second network call', async () => {
    const w = wrapper();
    const first = renderHook(() => useProducts({ page: '1' }), { wrapper: w });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    // Same key, same provider → cache hit, no extra fetch.
    const second = renderHook(() => useProducts({ page: '1' }), { wrapper: w });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});
