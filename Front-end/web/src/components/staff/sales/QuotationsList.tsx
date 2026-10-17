'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { QUOTATION_STATUS } from './QuotationDetail';
import { errorMessage, rupees, type QuotationPage } from './types';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
] as const;

/** GTM quotations, newest first: the seller's own, or the whole team's for the head. */
export default function QuotationsList() {
  const [status, setStatus] = useState<string>('open');
  const q = useInfiniteQuery({
    queryKey: staffKeys.quotationList(status),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (pageParam) qs.set('cursor', pageParam);
      return apiClient.get<QuotationPage>(`/staff/sales/quotations${qs.toString() ? `?${qs}` : ''}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.quotations) ?? [];
  const team = q.data?.pages[0]?.scope === 'team';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Quotation status">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={status === f.key} onClick={() => setStatus(f.key)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${status === f.key ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading quotations…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load quotations.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No quotations here. Create one from “New quotation”.
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/team/sales/quotations/${r.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
              <span className="font-semibold text-gray-900">{r.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.customer.name}</span>
              {team && r.salesPerson && <span className="text-xs text-gray-500">{r.salesPerson}</span>}
              <span className="text-sm font-semibold text-gray-900">{rupees(r.totalAmount)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${QUOTATION_STATUS[r.status].cls}`}>{QUOTATION_STATUS[r.status].text}</span>
              <span className="w-full text-xs text-gray-500">Updated {formatDateTimeIST(r.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
