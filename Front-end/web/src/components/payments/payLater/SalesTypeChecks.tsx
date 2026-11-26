'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { formatDateIST } from '@/lib/datetime';
import { rupees } from '@/components/staff/sales/types';
import SalesTypeBadge from '@/components/staff/sales/SalesTypeBadge';
import { salesTypeKeys, type SalesTypeRow } from './api';
import SalesTypeApprove from './SalesTypeApprove';
import SalesTypeChange from './SalesTypeChange';
import OrderPayLater from './OrderPayLater';

type Page = { orders: SalesTypeRow[]; nextCursor?: string | null; canCheck?: boolean };

/**
 * Accounts (and the admin; the GTM head reads only):
 *   view=check      → GTM orders whose B2B / B2C accounts has not approved yet
 *   view=b2b_unpaid → approved B2B orders not paid yet — "Ship before payment" here
 *   view=approved   → every approved GTM order — "Change to B2B / B2C" here
 * Keyset-paged by the server; every rule is the server's.
 */
export type SalesTypeView = 'check' | 'b2b_unpaid' | 'approved';

export default function SalesTypeChecks({ view, orderHref }: { view: SalesTypeView; orderHref?: (id: string) => string }) {
  const list = useInfiniteQuery({
    queryKey: salesTypeKeys.list(view),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => (await apiClient.get(`/staff/sales-type-checks?view=${view}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`)) as unknown as Page,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.orders) ?? [];
  const canCheck = !!list.data?.pages[0]?.canCheck;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {view === 'check' && 'GTM marked these orders B2B (business, no offers) or B2C (retail, offers allowed). Check the reason and approve with a note.'}
        {view === 'b2b_unpaid' && 'B2B orders accounts approved that are not paid yet. Accounts or the admin can let one ship before payment, with a reason.'}
        {view === 'approved' && 'Every approved B2B / B2C order, newest first. Approved the wrong type? Change it here with a reason — every change is kept.'}
      </p>
      {list.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {list.isError && <p role="alert" className="text-sm text-red-700">Could not load the list.</p>}
      {!list.isLoading && !list.isError && !rows.length && <p className="text-sm text-gray-500">Nothing here.</p>}
      <ul className="space-y-2">
        {rows.map((o) => <Row key={o.id} o={o} view={view} canCheck={canCheck} orderHref={orderHref} />)}
      </ul>
      {list.hasNextPage && <button type="button" onClick={() => list.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Load more</button>}
    </div>
  );
}

function Row({ o, view, canCheck, orderHref }: { o: SalesTypeRow; view: string; canCheck: boolean; orderHref?: (id: string) => string }) {
  const [shipOpen, setShipOpen] = useState(false);
  return (
    <li className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {orderHref ? <Link className="text-blue-700 hover:underline" href={orderHref(o.id)}>{o.orderNumber}</Link> : o.orderNumber}
            {' · '}{o.customer.name}{o.customer.city ? `, ${o.customer.city}` : ''}
          </p>
          <p className="text-xs text-gray-600">
            {o.customer.phone}{o.salesPerson ? ` · sold by ${o.salesPerson}` : ''} · {formatDateIST(o.createdAt)}
            {o.paymentStatus === 'paid' ? ' · paid' : ' · not paid yet'}
          </p>
        </div>
        <p className="text-base font-bold text-gray-900">{rupees(o.amount)}</p>
      </div>
      <SalesTypeBadge info={o.salesType} detail={view !== 'check'} />
      {view === 'check' && canCheck && <SalesTypeApprove orderId={o.id} label={o.salesType.label} />}
      {canCheck && o.typeChange && (view === 'approved' || view === 'check') && <SalesTypeChange orderId={o.id} option={o.typeChange} />}
      {view === 'b2b_unpaid' && canCheck && (
        shipOpen
          ? <OrderPayLater orderId={o.id} hideType />
          : <button type="button" onClick={() => setShipOpen(true)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-50">Ship before payment…</button>
      )}
    </li>
  );
}
