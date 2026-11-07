'use client';

import { Suspense, useState } from 'react';
import OrderListFilters, { useOrderListParams } from '@/components/staff/OrderListFilters';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import PinButton from '@/components/staff/PinButton';
import CopyId from '@/components/ui/CopyId';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import WorkOrderPanel from './WorkOrderPanel';
import { STAGE_TONE, type WorkQueue, type WorkRow } from './types';
import { EtaRowBadge } from './ParcelEta';
import OrderTypeTag from '@/components/orders/OrderTypeTag';

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
    <li className={`rounded-xl border bg-white ${order.pinned ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex items-start">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {order.customer.name || 'Customer'} <span className="font-normal text-gray-500">· {order.orderNumber}</span>
            <OrderTypeTag type="purchase" className="ml-2 align-middle" />
          </p>
          <p className="text-xs text-gray-500">
            Paid {formatDateTimeIST(order.paidAt || order.enteredAt || order.createdAt)} · {order.soldBy}{order.city ? ` · ${order.city}` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-gray-600">
            {order.lines.map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${l.quantity}`).join(', ')}
          </p>
        </div>
        {order.summary && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${order.summaryStage ? STAGE_TONE[order.summaryStage] : 'bg-amber-50 text-amber-800'}`}>
            {order.summary}
          </span>
        )}
        <EtaRowBadge eta={order.eta} />
        <span className="ml-auto text-right text-sm font-bold text-gray-900 sm:ml-0 sm:w-28">{rupees(order.totalAmount)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Beside the pin, not inside the row's button (a button cannot hold a button). */}
      <div className="mr-3 mt-3 flex items-center gap-1">
        <CopyId value={order.orderNumber} label="Order number" />
        <PinButton orderId={order.id} pinned={!!order.pinned} />
      </div>
      </div>
      {open && <div className="border-t border-gray-100 p-4"><WorkOrderPanel orderId={order.id} /></div>}
    </li>
  );
}

/**
 * One team's work list, newest first. The search, filters and sort live in the
 * page address (read with useSearchParams, hence the Suspense).
 */
export default function WorkQueueList({ queue }: { queue: WorkQueue }) {
  return <Suspense fallback={null}><QueueList queue={queue} /></Suspense>;
}

function QueueList({ queue }: { queue: WorkQueue }) {
  const list = useOrderListParams('work', { showEta: queue === 'deliveries' });
  const { params, filtered } = list;
  const q = useInfiniteQuery({
    queryKey: staffKeys.workQueue(queue, params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ queue, ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/work?${qs}`);
    },
    // Keep the old list on screen while a new search loads (no flash of "Loading…").
    placeholderData: keepPreviousData,
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
  });
  const orders = q.data?.pages.flatMap((p) => p.orders) ?? [];

  const bar = (
    <OrderListFilters list={list} shown={q.isSuccess ? { count: orders.length, more: q.hasNextPage } : undefined}>
      <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </OrderListFilters>
  );
  if (q.isPending) return <div className="space-y-3">{bar}<p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p></div>;
  if (q.isError) return <div className="space-y-3">{bar}<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p></div>;

  return (
    <div className="space-y-3">
      {bar}
      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {filtered ? 'No orders match — try fewer words or clear the filters.' : EMPTY[queue]}
        </p>
      ) : (
        <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>{orders.map((o) => <Row key={o.id} order={o} />)}</ul>
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
