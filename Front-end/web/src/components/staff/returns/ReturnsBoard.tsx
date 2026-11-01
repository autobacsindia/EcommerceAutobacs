'use client';

/**
 * The team's returns, one tab per step that team owns (operations: check, pickup,
 * inspect; procurement: supplier pickups and claims; accounts and procurement: what
 * suppliers owe us; sellers: their own). Cursor-paged; the server searches, filters
 * and sorts, so every page honours them. The tab, search and filters live in the
 * page address — the bell links straight to a tab (?tab=…) — so the page must wrap
 * this in <Suspense>.
 */
import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatDateIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect, listField } from '@/components/panel/ListControls';
import ReturnPanel from './ReturnPanel';
import { FAULT_LABEL, FAULT_TONE, ORIGIN_OPTIONS, REASON_OPTIONS, SETTLEMENT_LABEL, tabsFor, type ReturnQueue, type ReturnRow } from './types';

type Summary = { count: number; capped: boolean; total?: number | null };
type Page = { success: boolean; returns: ReturnRow[]; nextCursor: string | null; summary?: Summary; searchCapped?: boolean };
type OwedRow = {
  returnId: string; returnRef: string; claimId: string; supplierName: string; kind: string | null; amount: number;
  reference: string | null; paymentRequestRef: string | null; promisedAt: string | null; ageDays: number | null;
};
type OwedPage = {
  success: boolean; items: OwedRow[]; totals: { supplierName: string; amount: number; claims: number }[] | null;
  nextCursor: string | null; summary?: Summary;
};

const RETURN_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Waiting longest first' },
];
// The list filters (not the sort); any of them on → "Clear all".
const RETURN_FILTERS = ['q', 'reason', 'origin', 'from', 'to'] as const;

const OWED_SORTS = [
  { value: 'oldest', label: 'Promised longest ago first' },
  { value: 'newest', label: 'Promised most recently first' },
  { value: 'amount_desc', label: 'Amount: high to low' },
  { value: 'amount_asc', label: 'Amount: low to high' },
];
const OWED_FILTERS = ['q', 'supplier', 'kind'] as const;

/** Only the values that are set, for the query string and the cache key. */
const setOnly = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
const moreButton = 'w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

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
  const { values: v, set, clear } = useListParams({ q: '', reason: '', origin: '', from: '', to: '', sort: 'newest' });
  const [showFilters, setShowFilters] = useState(false);
  const sort = RETURN_SORTS.some((x) => x.value === v.sort) ? v.sort : 'newest';
  const params = setOnly({
    ...Object.fromEntries(RETURN_FILTERS.map((k) => [k, v[k]])), ...(sort !== 'newest' ? { sort } : {}),
  });
  const filtered = RETURN_FILTERS.some((k) => v[k]);
  const filtersOn = [v.reason, v.origin, v.from || v.to].filter(Boolean).length;
  const q = useInfiniteQuery({
    queryKey: staffKeys.returnList(queue, params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ queue, ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/returns?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.returns) ?? [];
  const first = q.data?.pages[0];
  return (
    <div className="space-y-3">
      <div role="search" aria-label="Search and filter returns" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search returns"
            placeholder="Search return no., order no., customer, phone, product, supplier" />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={RETURN_SORTS} />
          <button type="button" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters} aria-controls={`return-filters-${queue}`}
            className={`${listField} inline-flex items-center gap-1.5 sm:hidden`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{filtersOn ? ` · ${filtersOn} on` : ''}
          </button>
        </div>
        <div id={`return-filters-${queue}`} className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-center gap-2 sm:flex`}>
          <ListSelect label="Reason" value={v.reason} onChange={(x) => set({ reason: x })} allLabel="Any reason" options={REASON_OPTIONS} />
          <ListSelect label="Came from" value={v.origin} onChange={(x) => set({ origin: x })} allLabel="Raised anywhere" options={ORIGIN_OPTIONS} />
          <ListDateRange label="Raised on" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
            <span>Raised</span>
          </ListDateRange>
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {first?.summary
            ? <ListResultLine count={first.summary.count} capped={first.summary.capped} noun={['return', 'returns']} />
            : <span />}
          <div className="flex items-center gap-2">
            {filtered && <ListClear onClear={() => clear(['sort'])} />}
            <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
        {first?.searchCapped && <p className="text-xs text-amber-700">Searched the newest 20,000 returns — add a date to look further back.</p>}
      </div>
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {filtered ? 'No returns match — try fewer words or clear the filters.' : EMPTY[queue]}
        </p>
      )}
      {rows.length > 0 && (
        <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>{rows.map((r) => <Row key={r.id} r={r} showRefund={showRefund} />)}</ul>
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={moreButton}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * Every settlement a supplier promised and has not paid yet — oldest first, with totals.
 * The totals are always every supplier (press one to see only theirs); the line under
 * the search is what matches.
 */
export function SuppliersOweUs() {
  const { values: v, set, clear } = useListParams({ q: '', supplier: '', kind: '', sort: 'oldest' });
  const sort = OWED_SORTS.some((x) => x.value === v.sort) ? v.sort : 'oldest';
  const params = setOnly({ q: v.q, supplier: v.supplier, kind: v.kind, ...(sort !== 'oldest' ? { sort } : {}) });
  const filtered = OWED_FILTERS.some((k) => v[k]);
  const q = useInfiniteQuery({
    queryKey: staffKeys.suppliersOwe(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }).toString();
      return apiClient.get<OwedPage>(`/staff/returns/suppliers-owe-us${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>;
  const rows = q.data.pages.flatMap((p) => p.items);
  const first = q.data.pages[0];
  const totals = first?.totals || [];
  if (!rows.length && !filtered) return <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No supplier owes us anything right now.</p>;
  return (
    <div className="space-y-4">
      <ul className="grid gap-2 sm:grid-cols-2">
        {totals.map((t) => {
          const on = v.supplier === t.supplierName;
          return (
            <li key={t.supplierName}>
              <button type="button" aria-pressed={on} onClick={() => set({ supplier: on ? '' : t.supplierName })}
                className={`w-full rounded-lg border p-3 text-left text-sm ${on ? 'border-amber-500 bg-amber-100 ring-2 ring-amber-200' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}>
                <span className="block font-semibold text-amber-900">{t.supplierName}</span>
                <span className="block text-amber-800">{rupees(t.amount)} owed · {t.claims} claim{t.claims > 1 ? 's' : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div role="search" aria-label="Search what suppliers owe us" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search what suppliers owe"
            placeholder="Search supplier, return no., credit note no., PR no., amount" />
          <ListSelect label="Kind" value={v.kind} onChange={(x) => set({ kind: x })} allLabel="Any kind"
            options={Object.entries(SETTLEMENT_LABEL).map(([value, label]) => ({ value, label }))} />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={OWED_SORTS} />
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {first?.summary
            ? <ListResultLine count={first.summary.count} capped={first.summary.capped} total={first.summary.total} noun={['claim', 'claims']} formatTotal={rupees} />
            : <span />}
          {filtered && <ListClear onClear={() => clear(['sort'])} />}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nothing owed matches — try fewer words or clear the filters.</p>
      ) : (
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
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
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={moreButton}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// Every key the lists keep in the address: a new tab starts with none of them.
const LIST_KEYS = { q: '', reason: '', origin: '', from: '', to: '', sort: '', supplier: '', kind: '' };

export default function ReturnsBoard(who: { team: string; isHead: boolean; canSell: boolean; isAdmin: boolean }) {
  const tabs = tabsFor(who);
  const { values, set } = useListParams({ tab: '', ...LIST_KEYS });
  // An unknown tab (an old link, another team's bell) opens the person's first tab.
  const tab = tabs.find((t) => t.key === values.tab)?.key || tabs[0]?.key || 'all';
  if (!tabs.length) return <p className="text-sm text-gray-500">Returns are handled by operations, procurement, accounts and GTM sellers.</p>;
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => set({ ...LIST_KEYS, tab: t.key })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === t.key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'owed' ? <SuppliersOweUs /> : <ReturnList key={tab} queue={tab as ReturnQueue} showRefund={tab === 'refund'} />}
    </div>
  );
}
