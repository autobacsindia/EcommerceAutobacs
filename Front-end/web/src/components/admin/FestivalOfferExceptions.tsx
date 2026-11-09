'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { adminKeys } from '@/hooks/queries/keys';
import type { FestivalOfferSetting } from '@/lib/festival/festivalOffer';
import { festivalSettingLabel } from '@/lib/festival/festivalOfferSetting';
import FestivalOfferBulkBar from './FestivalOfferBulkBar';

interface ExceptionRow {
  _id: string;
  name: string;
  price: number;
  festivalOfferSetting: FestivalOfferSetting;
}
interface ExceptionsPage { products: ExceptionRow[]; nextCursor: string | null }
type Filter = 'all' | 'none' | 'custom';

const PAGE_SIZE = 50;

/** Products not on Automatic. Cursor-paged by the server, so it stays bounded. */
export default function FestivalOfferExceptions({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const key = adminKeys.list('products-festival-exceptions', { mode: filter });

  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: key,
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (filter !== 'all') q.set('mode', filter);
      if (pageParam) q.set('cursor', pageParam);
      return apiClient.get<ExceptionsPage>(`${API_ENDPOINTS.PRODUCT_FESTIVAL_OFFER_EXCEPTIONS}?${q.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = data?.pages.flatMap((p) => p.products) ?? [];

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="mb-6">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm font-medium text-blue-700 hover:underline">
        🪔 {open ? 'Hide' : 'Show'} products with a special Diwali offer
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value as Filter); setSelected(new Set()); }}
            className="mb-3 rounded-lg border bg-white px-3 py-2 text-sm"
            aria-label="Filter Diwali offer exceptions"
          >
            <option value="all">Excluded and custom</option>
            <option value="none">Excluded only</option>
            <option value="custom">Custom % only</option>
          </select>
          {canEdit && (
            <FestivalOfferBulkBar
              selectedIds={[...selected]}
              onDone={() => {
                setSelected(new Set());
                queryClient.invalidateQueries({ queryKey: adminKeys.resource('products-festival-exceptions') });
                onChanged();
              }}
            />
          )}
          {isError && <p className="text-sm text-red-700">Couldn&apos;t load this list. Please try again.</p>}
          {open && isPending && <p className="text-sm text-gray-500">Loading...</p>}
          {!isPending && !isError && rows.length === 0 && <p className="text-sm text-gray-500">Every product is on Automatic.</p>}
          <ul className="divide-y divide-gray-100">
            {rows.map((p) => (
              <li key={p._id} className="flex items-center gap-3 py-2 text-sm">
                {canEdit && (
                  <input type="checkbox" checked={selected.has(p._id)} onChange={() => toggle(p._id)} aria-label={`Select ${p.name}`} />
                )}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{festivalSettingLabel(p.festivalOfferSetting)}</span>
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
