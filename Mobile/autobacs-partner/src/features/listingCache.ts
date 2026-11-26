/**
 * Query keys + one helper that writes a server-returned listing into every
 * cache that shows it. Called only with the SERVER's reply — never a guess.
 */
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Listing, Page } from '../api';

export const listingsKey = (status?: string) => ['listings', status ?? 'all'] as const;
export const listingKey = (id: string) => ['listing', id] as const;

export function storeListing(qc: QueryClient, l: Listing) {
  qc.setQueryData(listingKey(l.id), l);
  qc.setQueriesData<InfiniteData<Page<Listing>>>({ queryKey: ['listings'] }, (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === l.id ? l : x)) })) }
      : data,
  );
}

/** After create / status change the list order or filter membership may change. */
export function refreshLists(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ['listings'] });
}
