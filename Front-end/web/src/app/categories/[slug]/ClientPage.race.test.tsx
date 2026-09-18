/**
 * Out-of-order responses must not paint.
 *
 * This page awaits three times before it sets state (category → scope → products),
 * so a run started for one URL can still have its response in flight when a later
 * run overtakes it. If the stale answer painted, the grid would show subcategory A
 * while the URL, the sidebar checkbox and the active-filter chips all said B.
 *
 * It does not, and the reason is worth pinning: React runs an effect's CLEANUP
 * before the next run starts, so the superseded run's own `isMounted` closure is
 * already false when its response lands. `isMounted` is doing double duty as a
 * per-run "superseded" flag, which is easy to mistake for an unmount-only guard
 * and 'fix' with a redundant sequence counter — or to break by hoisting the flag
 * into a ref shared across runs. This test is what notices either.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

let currentUrl = '/categories/audio?category=sub-a';

// Cached per URL, like the real hook: it returns a referentially stable object
// per navigation, and this page's effect keys off it. A fresh instance each
// render would re-run the fetch forever.
const spCache = new Map<string, URLSearchParams>();
const searchParamsOf = (url: string) => {
  let sp = spCache.get(url);
  if (!sp) {
    sp = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    spCache.set(url, sp);
  }
  return sp;
};

jest.mock('next/navigation', () => ({
  usePathname: () => currentUrl.split('?')[0],
  useSearchParams: () => searchParamsOf(currentUrl),
}));

/** Product requests are held open so the test decides who finishes first. */
const pending: Array<{ path: string; resolve: (v: unknown) => void }> = [];

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn((path: string) => {
      if (path.startsWith('/categories')) {
        return Promise.resolve({
          categories: [
            { _id: 'hub-audio', name: 'Audio', slug: 'audio' },
            { _id: 'sub-a', name: 'Sub A', slug: 'sub-a', parent: { _id: 'hub-audio' } },
            { _id: 'sub-b', name: 'Sub B', slug: 'sub-b', parent: { _id: 'hub-audio' } },
          ],
          pagination: { pages: 1 },
        });
      }
      return new Promise((resolve) => pending.push({ path, resolve }));
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

/** Settle the request the given run is waiting on. */
const settle = (index: number, name: string) =>
  pending[index].resolve({ products: [{ _id: name, name, images: [], price: 1 }], total: 1 });

function Page() {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  );
  return (
    <QueryClientProvider client={client}>
      <ClientPage slug="audio" initialCategory={HUB as never} />
    </QueryClientProvider>
  );
}

beforeEach(() => { pending.length = 0; });

it('paints the latest selection even when an earlier request finishes last', async () => {
  const { rerender } = render(<Page />);
  await waitFor(() => expect(pending).toHaveLength(1)); // run 1 (sub-a) in flight

  currentUrl = '/categories/audio?category=sub-b';
  rerender(<Page />);
  await waitFor(() => expect(pending).toHaveLength(2)); // run 2 (sub-b) in flight

  expect(pending[0].path).toContain('sub-a');
  expect(pending[1].path).toContain('sub-b');

  settle(1, 'FROM-SUB-B');                                   // newer answers first
  await waitFor(() => expect(screen.getByTestId('grid')).toHaveTextContent('FROM-SUB-B'));

  settle(0, 'FROM-SUB-A');                                   // stale answer lands late
  await new Promise((r) => setTimeout(r, 20));

  // Still the newer selection — the stale run was cleaned up before it resolved.
  expect(screen.getByTestId('grid')).toHaveTextContent('FROM-SUB-B');
});
