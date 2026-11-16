'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { adminKeys } from '@/hooks/queries/keys';
import {
  SHIPPING_CLASSES,
  SHIPPING_CLASS_LABELS,
  shippingClassLabel,
  type ShippingClass,
  type ShippingClassSource,
} from '@/lib/shippingClass';
import ShippingClassBulkBar from './ShippingClassBulkBar';
import ShippingClassBoxes from './ShippingClassBoxes';

interface Row {
  _id: string;
  name: string;
  isActive?: boolean;
  shippingClass: ShippingClass | null;
  shippingClassSource: ShippingClassSource | null;
}
interface Page { products: Row[]; nextCursor: string | null }
type Filter = ShippingClass | 'none';

const PAGE_SIZE = 50;

/**
 * Products in one size class ('Not set' by default — the to-do list). Cursor-paged
 * by the server, so it stays bounded; the main list's search runs on Atlas Search
 * and does not filter on this admin-only field.
 */
export default function ShippingClassList({
  canEdit,
  canEditBoxes,
  onChanged,
}: {
  canEdit: boolean;
  canEditBoxes: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('none');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: adminKeys.list('products-shipping-class', { class: filter }),
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ class: filter, limit: String(PAGE_SIZE) });
      if (pageParam) q.set('cursor', pageParam);
      return apiClient.get<Page>(`${API_ENDPOINTS.PRODUCT_SHIPPING_CLASS_LIST}?${q.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = data?.pages.flatMap((p) => p.products) ?? [];
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r._id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllShown = () => setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r._id)));

  return (
    <div className="mb-6">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm font-medium text-blue-700 hover:underline">
        📦 {open ? 'Hide' : 'Show'} products by size class
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <select
              value={filter}
              onChange={(e) => { setFilter(e.target.value as Filter); setSelected(new Set()); }}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
              aria-label="Filter by size class"
            >
              <option value="none">Not set yet</option>
              {SHIPPING_CLASSES.map((c) => <option key={c} value={c}>{SHIPPING_CLASS_LABELS[c]}</option>)}
            </select>
            {canEdit && rows.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} />
                Select all shown ({rows.length})
              </label>
            )}
          </div>
          {canEdit && (
            <ShippingClassBulkBar
              selectedIds={[...selected]}
              onDone={() => {
                setSelected(new Set());
                queryClient.invalidateQueries({ queryKey: adminKeys.resource('products-shipping-class') });
                onChanged();
              }}
            />
          )}
          {isError && <p className="text-sm text-red-700">Couldn&apos;t load this list. Please try again.</p>}
          {isPending && <p className="text-sm text-gray-500">Loading...</p>}
          {!isPending && !isError && rows.length === 0 && <p className="text-sm text-gray-500">No products here.</p>}
          <ul className="divide-y divide-gray-100">
            {rows.map((p) => (
              <li key={p._id} className="flex items-center gap-3 py-2 text-sm">
                {canEdit && (
                  <input type="checkbox" checked={selected.has(p._id)} onChange={() => toggle(p._id)} aria-label={`Select ${p.name}`} />
                )}
                <span className="min-w-0 flex-1 truncate">{p.name}{p.isActive === false && <span className="ml-2 text-xs text-gray-400">(draft)</span>}</span>
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
                  {shippingClassLabel(p.shippingClass)}{p.shippingClassSource === 'auto' ? ' · auto' : ''}
                </span>
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50">
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
          <ShippingClassBoxes canEdit={canEditBoxes} />
        </div>
      )}
    </div>
  );
}
