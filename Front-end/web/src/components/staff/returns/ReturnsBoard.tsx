'use client';

/**
 * The team's returns, one tab per step that team owns (operations: check, pickup,
 * inspect; procurement: supplier pickups and claims; accounts and procurement: what
 * suppliers owe us; sellers: their own). Newest first, cursor-paged. The bell links
 * straight to a tab (?tab=…).
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatDateIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import ReturnPanel from './ReturnPanel';
import { FAULT_LABEL, FAULT_TONE, SETTLEMENT_LABEL, tabsFor, type ReturnQueue, type ReturnRow } from './types';

type Page = { success: boolean; returns: ReturnRow[]; nextCursor: string | null };
type OwedRow = {
  returnId: string; returnRef: string; claimId: string; supplierName: string; kind: string | null; amount: number;
  reference: string | null; paymentRequestRef: string | null; promisedAt: string | null; ageDays: number | null;
};
type OwedPage = { success: boolean; items: OwedRow[]; totals: { supplierName: string; amount: number; claims: number }[] | null; nextCursor: string | null };

const EMPTY: Record<ReturnQueue, string> = {
  review: 'No returns waiting for check 1.',
  pickup: 'No pickups to book or wait for.',
  inspect: 'Nothing to inspect.',
  supplier_pickup: 'No returns going straight to a supplier.',
  refund: 'No return refunds to send.',
  supplier: 'No supplier claims to chase.',
  mine: 'No returns on your orders.',
  all: 'No returns yet.',
};

function Row({ r, showRefund }: { r: ReturnRow; showRefund: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {r.customer || 'Customer'} <span className="font-normal text-gray-500">· return {r.ref}{r.orderNumber ? ` · order ${r.orderNumber}` : ''}</span>
          </p>
          <p className="text-xs text-gray-500">
            Raised {formatDateTimeIST(r.createdAt)}{r.ageDays ? ` · ${r.ageDays} day${r.ageDays > 1 ? 's' : ''} ago` : ''}{r.origin === 'customer' ? ' · website' : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
            {r.items.map((i, k) => (
              <span key={k} className="inline-flex items-center gap-1">
                {i.name} × {i.quantity} — {i.reasonLabel}
                <span className={`rounded px-1 text-[10px] font-semibold ${FAULT_TONE[i.fault]}`}>{FAULT_LABEL[i.fault]}</span>
              </span>
            ))}
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{r.stage}</span>
        {r.refund.amount > 0 && ['processing', 'completed'].includes(r.refund.status) && (
          <span className="text-sm font-bold text-gray-900">{rupees(r.refund.amount)}</span>
        )}
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-gray-100 p-4"><ReturnPanel id={r.id} showRefund={showRefund} /></div>}
    </li>
  );
}

export function ReturnList({ queue, showRefund = false }: { queue: ReturnQueue; showRefund?: boolean }) {
  const q = useInfiniteQuery({
    queryKey: staffKeys.returnList(queue),
    queryFn: ({ pageParam }) => apiClient.get<Page>(`/staff/returns?queue=${queue}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.returns) ?? [];
  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{rows.length ? `${rows.length}${q.hasNextPage ? '+' : ''} · newest first` : ''}</p>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {rows.length === 0
        ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{EMPTY[queue]}</p>
        : <ul className="space-y-3">{rows.map((r) => <Row key={r.id} r={r} showRefund={showRefund} />)}</ul>}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** Every settlement a supplier promised and has not paid yet — oldest first, with totals. */
export function SuppliersOweUs() {
  const q = useInfiniteQuery({
    queryKey: staffKeys.suppliersOwe(),
    queryFn: ({ pageParam }) => apiClient.get<OwedPage>(`/staff/returns/suppliers-owe-us${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>;
  const rows = q.data.pages.flatMap((p) => p.items);
  const totals = q.data.pages[0]?.totals || [];
  if (!rows.length) return <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No supplier owes us anything right now.</p>;
  return (
    <div className="space-y-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {totals.map((t) => (
          <li key={t.supplierName} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-900">{t.supplierName}</p>
            <p className="text-amber-800">{rupees(t.amount)} owed · {t.claims} claim{t.claims > 1 ? 's' : ''}</p>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-2">Supplier</th><th className="p-2">Promised</th><th className="p-2">Amount</th><th className="p-2">Waiting</th><th className="p-2">Return</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.claimId} className="border-t border-gray-100">
                <td className="p-2 font-medium">{r.supplierName}</td>
                <td className="p-2">{r.kind ? SETTLEMENT_LABEL[r.kind] : '—'}{r.reference ? ` · ${r.reference}` : ''}{r.promisedAt ? ` · ${formatDateIST(r.promisedAt)}` : ''}</td>
                <td className="p-2">{rupees(r.amount)}</td>
                <td className={`p-2 ${r.ageDays != null && r.ageDays > 30 ? 'font-semibold text-red-700' : ''}`}>{r.ageDays != null ? `${r.ageDays} days` : '—'}</td>
                <td className="p-2 text-gray-600">{r.returnRef}{r.paymentRequestRef ? ` · ${r.paymentRequestRef}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function ReturnsBoard(who: { team: string; isHead: boolean; canSell: boolean; isAdmin: boolean }) {
  const tabs = tabsFor(who);
  const params = useSearchParams();
  const wanted = params?.get('tab');
  const [tab, setTab] = useState<string>(tabs.find((t) => t.key === wanted)?.key || tabs[0]?.key || 'all');
  if (!tabs.length) return <p className="text-sm text-gray-500">Returns are handled by operations, procurement, accounts and GTM sellers.</p>;
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'owed' ? <SuppliersOweUs /> : <ReturnList key={tab} queue={tab as ReturnQueue} showRefund={tab === 'refund'} />}
    </div>
  );
}
