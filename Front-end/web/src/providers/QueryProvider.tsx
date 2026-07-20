'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The single client-side data cache for the app (TanStack Query).
 *
 * Replaces the hand-rolled fetch-in-useEffect pattern spread across ~112 call
 * sites plus two uncoordinated bespoke caches. Gives request dedup, cache-first
 * with background revalidation, instant back/forward restore, and one
 * invalidation story shared by storefront + admin.
 *
 * The QueryClient is created once per browser session via useState (NOT at
 * module scope), so a Suspense/error re-render never discards the cache and, in
 * SSR, requests never leak across users.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1 min: served from cache without a refetch
            gcTime: 300_000, // 5 min: kept in memory after last use
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default QueryProvider;
