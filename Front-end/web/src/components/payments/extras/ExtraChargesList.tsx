'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { extraKeys, type ExtraCharge } from './api';
import ExtraChargeCard from './ExtraChargeCard';

const TABS = [
  { value: 'awaiting_accounts', label: 'Waiting for Accounts' },
  { value: 'approved', label: 'Waiting for customer' },
  { value: 'paid', label: 'Paid' },
  { value: 'refund_due', label: 'Refund due' },
  { value: 'closed', label: 'Rejected or cancelled' },
];
type Page = { extras: ExtraCharge[]; nextCursor?: string | null };

/** Every extra charge this person may see, one tab at a time. Keyset-paged by the server. */
export default function ExtraChargesList({ orderBase, fixedTab }: { orderBase?: string; fixedTab?: string }) {
  const [chosen, setTab] = useState('awaiting_accounts');
  const tab = fixedTab ?? chosen;
  const list = useInfiniteQuery({
    queryKey: extraKeys.list(tab),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => (await apiClient.get(`/staff/extra-charges?tab=${tab}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`)) as unknown as Page,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const extras = list.data?.pages.flatMap((p) => p.extras) ?? [];
  return (
    <div className="space-y-4">
      {!fixedTab && <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={t.value === tab} onClick={() => setTab(t.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${t.value === tab ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{t.label}</button>
        ))}
      </div>}
      {list.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {list.isError && <p role="alert" className="text-sm text-red-700">Could not load the extra charges.</p>}
      {!list.isLoading && !extras.length && !list.isError && <p className="text-sm text-gray-500">Nothing here.</p>}
      <ul className="space-y-2">{extras.map((e) => <ExtraChargeCard key={e.id} extra={e} showOrder orderBase={orderBase} />)}</ul>
      {list.hasNextPage && <button type="button" onClick={() => list.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Load more</button>}
    </div>
  );
}
