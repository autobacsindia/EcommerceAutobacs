'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { rupees } from '@/components/staff/sales/types';
import { payLaterKeys, type PayLaterRow, type PayLaterSummary } from './api';
import PayLaterBadge from './PayLaterBadge';
import SalesTypeChecks, { type SalesTypeView } from './SalesTypeChecks';
import { WithdrawPayLater } from './OrderPayLater';

const TABS = [
  { value: 'check', label: 'B2B / B2C to approve' },
  { value: 'b2b_unpaid', label: 'B2B not paid — ship before payment' },
  { value: 'approved', label: 'Approved B2B / B2C — change type' },
  { value: 'due', label: 'Shipped – not paid yet' },
  { value: 'paid', label: 'Paid after dispatch' },
];
type Page = { orders: PayLaterRow[]; nextCursor?: string | null; summary?: PayLaterSummary; canWithdraw?: boolean };

/** B2B / B2C approvals, and orders let ship before payment. Keyset-paged by the server; the sum is the server's. */
export default function PayLaterList({ orderHref }: { orderHref?: (id: string) => string }) {
  const [view, setView] = useState('check');
  const typeView = view === 'check' || view === 'b2b_unpaid' || view === 'approved';
  const list = useInfiniteQuery({
    enabled: !typeView,
    queryKey: payLaterKeys.list(view),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => (await apiClient.get(`/staff/pay-later?view=${view}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`)) as unknown as Page,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.orders) ?? [];
  const summary = list.data?.pages[0]?.summary;
  const canWithdraw = !!list.data?.pages[0]?.canWithdraw;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={t.value === view} onClick={() => setView(t.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${t.value === view ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {typeView && <SalesTypeChecks view={view as SalesTypeView} orderHref={orderHref} />}

      {!typeView && <>
      {view === 'due' && summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Totals">
          <div className="rounded-lg bg-white p-3 shadow-sm"><p className="text-xs text-gray-500">Customers owe</p><p className="text-lg font-bold">{rupees(summary.owed)}</p></div>
          <div className="rounded-lg bg-white p-3 shadow-sm"><p className="text-xs text-gray-500">Orders not paid</p><p className="text-lg font-bold">{summary.count}</p></div>
          <div className={`rounded-lg p-3 shadow-sm ${summary.overdue ? 'bg-red-50' : 'bg-white'}`}><p className="text-xs text-gray-500">Overdue (more than {summary.dueDays} days after dispatch)</p><p className={`text-lg font-bold ${summary.overdue ? 'text-red-700' : ''}`}>{summary.overdue}</p></div>
        </div>
      )}

      {list.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {list.isError && <p role="alert" className="text-sm text-red-700">Could not load the list.</p>}
      {!list.isLoading && !list.isError && !rows.length && <p className="text-sm text-gray-500">Nothing here.</p>}

      <ul className="space-y-2">
        {rows.map((o) => (
          <li key={o.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {orderHref ? <Link className="text-blue-700 hover:underline" href={orderHref(o.id)}>{o.orderNumber}</Link> : o.orderNumber}
                  {' · '}{o.customer.name}{o.customer.city ? `, ${o.customer.city}` : ''}
                </p>
                <p className="text-xs text-gray-600">
                  {o.customer.phone}{o.salesPerson ? ` · sold by ${o.salesPerson}` : ''}
                  {o.payLater?.dispatchedAt ? ` · sent ${formatDateIST(o.payLater.dispatchedAt)}` : ''}
                  {o.paidAt ? ` · paid ${formatDateIST(o.paidAt)}` : ''}
                </p>
              </div>
              <p className="text-base font-bold text-gray-900">{rupees(o.amount)}</p>
            </div>
            <div className="mt-2"><PayLaterBadge state={o.payLater} detail /></div>
            {o.bankTransferPending && <p className="mt-1 text-xs text-blue-800">A bank transfer is waiting for accounts to check.</p>}
            {o.payLater?.reason && <p className="mt-1 text-xs text-gray-500">Why: {o.payLater.reason} ({o.payLater.approvedBy || 'admin'})</p>}
            {canWithdraw && view === 'due' && o.payLater && !o.payLater.dispatchedAt && o.paymentStatus !== 'paid' && o.status === 'processing' && (
              <div className="mt-2"><WithdrawPayLater orderId={o.id} /></div>
            )}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button type="button" onClick={() => list.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Load more</button>}
      </>}
    </div>
  );
}
