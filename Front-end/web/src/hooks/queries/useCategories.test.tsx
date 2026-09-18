/**
 * The taxonomy query must return the WHOLE taxonomy.
 *
 * `/categories` is capped, and production quietly exceeded it: 296 active
 * categories against a limit of 200 meant the default response was page 1 of 2,
 * with a 200 status and nothing in the body flagging it. Truncation here does not
 * surface as an error — it surfaces as categories that appear not to exist. It
 * cost the chip strip the `Winch` hub, and left 95 of 283 subcategory checkboxes
 * inert because the scope check could not confirm they belonged to their hub.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCategories } from './useCategories';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const get = apiClient.get as jest.Mock;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const page = (ids: string[], pages: number) => ({
  categories: ids.map((id) => ({ _id: id, name: id, slug: id })),
  pagination: { pages, total: 0 },
});

beforeEach(() => get.mockReset());

it('returns a single page as-is', async () => {
  get.mockResolvedValue(page(['a', 'b'], 1));

  const { result } = renderHook(() => useCategories(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  expect(result.current.data!.map((c) => c._id)).toEqual(['a', 'b']);
  expect(get).toHaveBeenCalledTimes(1);
});

it('follows pagination instead of silently truncating', async () => {
  get.mockImplementation(async (path: string) =>
    path.includes('page=2') ? page(['c'], 2) : page(['a', 'b'], 2)
  );

  const { result } = renderHook(() => useCategories(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  // The hub that lived on page 2 is the one the chip strip lost.
  expect(result.current.data!.map((c) => c._id)).toEqual(['a', 'b', 'c']);
  expect(get).toHaveBeenCalledWith('/categories?page=2');
});

it('stops at a sane page count rather than looping on a bad response', async () => {
  get.mockResolvedValue(page(['x'], 9999));

  const { result } = renderHook(() => useCategories(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  expect(get.mock.calls.length).toBeLessThanOrEqual(10);
});

it('survives a response with no pagination block', async () => {
  get.mockResolvedValue({ categories: [{ _id: 'a', name: 'A', slug: 'a' }] });

  const { result } = renderHook(() => useCategories(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  expect(result.current.data).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(1);
});
