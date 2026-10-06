'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import WorkOrderPanel from './WorkOrderPanel';
import type { WorkQueue, WorkRow } from './types';

type Page = { success: boolean; orders: WorkRow[]; nextCursor: string | null };

const EMPTY: Record<WorkQueue, string> = {
  procurement: 'Nothing to check or ship right now.',
  decisions: 'No out-of-stock items waiting for a customer\'s answer.',
  refunds: 'No refunds waiting for approval.',
  deliveries: 'No parcels in transit.',
};

function Row({ order }: { order: WorkRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {order.customer.name || 'Customer'} <span className="font-normal text-gray-500">· {order.orderNumber}</span>
          </p>
          <p className="text-xs text-gray-500">
            Paid {formatDateTimeIST(order.enteredAt || order.createdAt)} · {order.soldBy}{order.city ? ` · ${order.city}` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-gray-600">
            {order.lines.map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${l.quantity}`).join(', ')}
          </p>
        </div>
        {order.summary && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{order.summary}</span>}
        <span className="ml-auto text-right text-sm font-bold text-gray-900 sm:ml-0 sm:w-28">{rupees(order.totalAmount)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-gray-100 p-4"><WorkOrderPanel orderId={order.id} /></div>}
    </li>
  );
}

/** One team's work list, oldest first — the order that has waited longest is on top. */
export default function WorkQueueList({ queue }: { queue: WorkQueue }) {
  const q = useInfiniteQuery({
    queryKey: staffKeys.workQueue(queue),
    queryFn: ({ pageParam }) =>
      apiClient.get<Page>(`/staff/work?queue=${queue}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
  });
  const orders = q.data?.pages.flatMap((p) => p.orders) ?? [];

  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{orders.length ? `${orders.length}${q.hasNextPage ? '+' : ''} waiting · oldest first` : ''}</p>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{EMPTY[queue]}</p>
      ) : (
        <ul className="space-y-3">{orders.map((o) => <Row key={o.id} order={o} />)}</ul>
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
