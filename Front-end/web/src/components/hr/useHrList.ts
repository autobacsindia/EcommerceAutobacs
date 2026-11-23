'use client';

import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { Page } from '@/lib/hr/types';

/**
 * A keyset "load more" list: each page asks the server for the next cursor.
 * Rows are concatenated in server order; no client-side paging or offsets.
 */
export function useHrList<T, P extends Page<T> = Page<T>>(queryKey: QueryKey, fetchPage: (cursor: string | null) => Promise<P>, enabled = true) {
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
  const pages = q.data?.pages ?? [];
  return {
    ...q,
    first: pages[0] as P | undefined,
    rows: pages.flatMap((p) => p.items) as T[],
  };
}
