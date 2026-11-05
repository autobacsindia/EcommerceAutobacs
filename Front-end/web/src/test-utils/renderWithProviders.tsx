import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A QueryClient tuned for tests:
 * - `retry: false` so a mocked rejection surfaces as an error immediately
 *   instead of waiting out the production retry/backoff.
 * - `gcTime: Infinity` so no garbage-collection timer outlives the test.
 * - `staleTime: 0` so each test sees the mocks it set up, not a cached answer.
 *
 * Always build a fresh client per render: a shared client would leak cached
 * responses between tests and make them order-dependent.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface ProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Pass a client to pre-seed or inspect the cache from the test. */
  queryClient?: QueryClient;
}

export type RenderWithProvidersResult = RenderResult & { queryClient: QueryClient };

/**
 * Drop-in replacement for RTL's `render` for any component that (directly or
 * through a child) uses TanStack Query hooks. The wrapper stays mounted across
 * `rerender`, so the cache survives re-renders within one test.
 *
 * Contexts (auth, cart, currency…) are intentionally NOT provided here — tests
 * already mock those per file, and wrapping real ones would fight those mocks.
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), ...options }: ProvidersOptions = {},
): RenderWithProvidersResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}
