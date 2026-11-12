'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { useListParams } from '@/lib/hooks/useListParams';
import {
  ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect, listField,
} from '@/components/panel/ListControls';
import { QUOTATION_STATUS } from './QuotationDetail';
import { errorMessage, percentText, rupees, type QuotationPage, type SalesFilterOptions } from './types';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'on_hold', label: 'On hold' },
  // Discounts above 10% waiting for the GTM head / an admin.
  { key: 'approval', label: 'Needs approval' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
] as const;

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Amount: high to low' },
  { value: 'amount_asc', label: 'Amount: low to high' },
] as const;
// Only on the On hold tab, where every quotation has a follow-up date.
const FOLLOW_UP = { value: 'follow_up', label: 'Follow-up date (soonest)' } as const;

const FILTER_KEYS = ['q', 'seller', 'from', 'to'] as const;

/**
 * GTM quotations: the seller's own, or the whole team's for the head. The
 * server does the searching and filtering, so every page honours them; the tab,
 * search, filters and sort live in the page address (Back, refresh and a shared
 * link keep them). The page must wrap this in <Suspense>.
 */
export default function QuotationsList() {
  const { values: v, set, clear } = useListParams({ status: 'open', sort: 'newest', q: '', seller: '', from: '', to: '' });
  const [showFilters, setShowFilters] = useState(false);
  // A tab the page does not offer (an old link) falls back to Open.
  const status = FILTERS.some((f) => f.key === v.status) ? v.status : 'open';
  const sorts = status === 'on_hold' ? [...SORTS, FOLLOW_UP] : SORTS;
  const sort = sorts.some((x) => x.value === v.sort) ? v.sort : 'newest';
  const params: Record<string, string> = {
    ...(status ? { status } : {}),
    ...(sort !== 'newest' ? { sort } : {}),
    ...Object.fromEntries(FILTER_KEYS.filter((k) => v[k]).map((k) => [k, v[k]])),
  };
  const filtered = FILTER_KEYS.some((k) => v[k]);
  const filtersOn = [v.seller, v.from || v.to].filter(Boolean).length;

  const q = useInfiniteQuery({
    queryKey: staffKeys.quotationList(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<QuotationPage>(`/staff/sales/quotations${qs.toString() ? `?${qs}` : ''}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    // Keep the old list on screen while a new search loads (no flash of "Loading…").
    placeholderData: keepPreviousData,
  });
  const choices = useQuery({
    queryKey: staffKeys.salesFilterOptions(),
    queryFn: () => apiClient.get<SalesFilterOptions>('/staff/sales/filter-options'),
    staleTime: 5 * 60_000,
  });
  const sellers = choices.data?.sellers ?? [];
  const rows = q.data?.pages.flatMap((p) => p.quotations) ?? [];
  const team = q.data?.pages[0]?.scope === 'team';
  const summary = q.data?.pages[0]?.summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Quotation status">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={status === f.key}
              // Leaving On hold drops its follow-up sort (the other tabs have no follow-up dates).
              onClick={() => set({ status: f.key, ...(f.key !== 'on_hold' && sort === 'follow_up' ? { sort: 'newest' } : {}) })}
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

      <div role="search" aria-label="Search and filter quotations" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search quotations"
            placeholder="Search quotation no., customer, phone, city, product, amount" />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={sorts} />
          <button type="button" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters} aria-controls="quotation-filters"
            className={`${listField} inline-flex items-center gap-1.5 sm:hidden`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{filtersOn ? ` · ${filtersOn} on` : ''}
          </button>
        </div>
        <div id="quotation-filters" className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-center gap-2 sm:flex`}>
          {sellers.length > 0 && (
            <ListSelect label="Salesman" value={v.seller} onChange={(x) => set({ seller: x })} allLabel="Any salesman"
              options={sellers.map((p) => ({ value: p.id, label: p.name }))} />
          )}
          <ListDateRange label="Created on" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
            <span>Created</span>
          </ListDateRange>
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary
            ? <ListResultLine count={summary.count} capped={summary.capped} total={summary.total} noun={['quotation', 'quotations']} formatTotal={rupees} />
            : <span />}
          {filtered && <ListClear onClear={() => clear(['status', 'sort'])} />}
        </div>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading quotations…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load quotations.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {filtered ? 'No quotations match — try fewer words or clear the filters.' : status === 'approval' ? 'No discount requests waiting.' : status === 'on_hold' ? 'Nothing on hold. Use “On hold – customer thinking” on a quotation when a customer needs time.' : 'No quotations here. Create one from “New quotation”.'}
        </p>
      )}

      <ul className={`space-y-2 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/team/sales/quotations/${r.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
              <span className="font-semibold text-gray-900">{r.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.customer.name}</span>
              {team && r.salesPerson && <span className="text-xs text-gray-500">{r.salesPerson}</span>}
              <span className="text-sm font-semibold text-gray-900">
                {rupees(r.totalAmount)}
                {r.discount && <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">{percentText(r.discount.percent)} off</span>}
              </span>
              {r.status === 'open' && r.approval && r.approval.state !== 'not_needed' && r.approval.state !== 'approved' && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.approval.state === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                  {r.approval.state === 'pending' ? 'Waiting for approval' : r.approval.state === 'rejected' ? 'Discount rejected' : 'Needs approval'}
                </span>
              )}
              {r.hold && (r.status === 'open' || r.status === 'expired')
                ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.hold.due ? 'bg-orange-100 text-orange-800' : 'bg-amber-100 text-amber-800'}`}>
                    {r.hold.due ? 'Follow up now' : `On hold · follow up ${formatDateIST(r.hold.until)}`}
                  </span>
                : <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${QUOTATION_STATUS[r.status].cls}`}>{QUOTATION_STATUS[r.status].text}</span>}
              <span className="w-full text-xs text-gray-500">Updated {formatDateTimeIST(r.updatedAt)}{r.hold?.note ? ` · ${r.hold.note}` : ''}</span>
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
