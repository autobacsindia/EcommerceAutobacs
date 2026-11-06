'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { formatDateIST } from '@/lib/datetime';
import { useListParams } from '@/lib/hooks/useListParams';
import {
  ListAmountRange, ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect, listField,
} from '@/components/panel/ListControls';
import {
  amountText, categoryName, errorMessage, foreignBill, getListFilterOptions, listRequests, paymentKeys, rupees, STATUS_TONE,
} from './api';
import PaymentRequestDetail from './PaymentRequestDetail';
import { DealLine } from './DealSummary';
import OrderTypeTag from '@/components/orders/OrderTypeTag';
import { STAFF_TEAM_LABELS } from '@/lib/staffTeams';

export type ListFilter = { value: string; label: string };

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first (waiting longest)' },
  { value: 'amount_desc', label: 'Amount: high to low' },
  { value: 'amount_asc', label: 'Amount: low to high' },
] as const;
const PAID_SORT = { value: 'paid_recent', label: 'Recently paid' } as const;
const KINDS = [{ value: 'supplier', label: 'Supplier payments' }, { value: 'expense', label: 'Expenses' }] as const;
const PAID_BY = [
  { value: 'bank', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' },
  { value: 'razorpay', label: 'Razorpay' }, { value: 'other', label: 'Other' },
] as const;
const DATE_OF = [{ value: 'raised', label: 'Raised on' }, { value: 'paid', label: 'Paid on' }] as const;

/** Everything a person can filter by, all kept in the page address. */
const FILTER_KEYS = ['q', 'team', 'kind', 'category', 'by', 'method', 'from', 'to', 'min', 'max'] as const;

const teamName = (team: string) => (team === 'admin' ? 'admin'
  : STAFF_TEAM_LABELS[team as keyof typeof STAFF_TEAM_LABELS] ?? team);

/**
 * Payment requests with search, filters, sort and a count; a row opens its
 * detail. What appears is decided by the server: a team sees its own, admin
 * and accounts see every team (and may filter by team and by who raised it).
 */
export default function PaymentRequestList({
  filters,
  initial,
  teams,
}: {
  /** The status buttons. */
  filters: ListFilter[];
  initial: string;
  /** Admin / accounts: the team filter (and the "raised by" filter with it). */
  teams?: { value: string; label: string }[];
}) {
  const { values: v, set, clear } = useListParams({
    status: initial, sort: 'newest', dateOf: 'raised',
    q: '', team: '', kind: '', category: '', by: '', method: '', from: '', to: '', min: '', max: '',
  });
  const [open, setOpen] = useState<string | null>(null);
  // Phones: the filters fold away behind a button so the list is not pushed off screen.
  const [showFilters, setShowFilters] = useState(false);
  const seesAll = !!teams;

  // A status the buttons do not offer (an old link) falls back to the page's own start.
  const status = filters.some((f) => f.value === v.status) ? v.status : initial;
  const paidList = status === 'paid';
  const sort = v.sort === PAID_SORT.value && !paidList ? 'newest' : v.sort;
  const params: Record<string, string> = {
    ...(status !== 'all' ? { status } : {}),
    ...(sort !== 'newest' ? { sort } : {}),
    ...Object.fromEntries(FILTER_KEYS.filter((k) => v[k]).map((k) => [k, v[k]])),
    ...(v.from || v.to ? { dateOf: v.dateOf } : {}),
  };
  const filtered = FILTER_KEYS.some((k) => v[k]);
  // How many filters are on (a date or amount range counts once), for the phone's Filters button.
  const filtersOn = [v.team, v.kind, v.category, v.by, v.method, v.from || v.to, v.min || v.max].filter(Boolean).length;

  const q = useInfiniteQuery({
    queryKey: paymentKeys.list(params),
    queryFn: ({ pageParam }) => listRequests(params, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const choices = useQuery({
    queryKey: paymentKeys.filterOptions(),
    queryFn: getListFilterOptions,
    staleTime: 5 * 60_000,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.requests);
  const summary = q.data?.pages[0]?.summary;
  const showPaidBy = paidList || status === 'all';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button key={f.value} type="button" aria-pressed={status === f.value}
            onClick={() => set({ status: f.value, ...(f.value !== 'paid' && v.sort === PAID_SORT.value ? { sort: 'newest' } : {}) })}
            className={`rounded-lg border px-3 py-1.5 text-sm ${status === f.value ? 'border-blue-600 bg-blue-50 font-medium text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div role="search" aria-label="Search and filter payments" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch
            value={v.q}
            onChange={(text) => set({ q: text.trim() })}
            label="Search payments"
            placeholder="Search PR number, payee or supplier, amount, UTR, order no., who raised it, description"
          />
          <ListSelect label="Sort" value={sort} onChange={(s) => set({ sort: s })}
            options={paidList ? [...SORTS, PAID_SORT] : SORTS} />
          <button type="button" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters} aria-controls="payment-filters"
            className={`${listField} inline-flex items-center gap-1.5 sm:hidden`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{filtersOn ? ` · ${filtersOn} on` : ''}
          </button>
        </div>
        <div id="payment-filters" className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-center gap-2 sm:flex`}>
          {teams && <ListSelect label="Team" value={v.team} onChange={(t) => set({ team: t })} options={teams} allLabel="All teams" />}
          <ListSelect label="Type" value={v.kind} onChange={(k) => set({ kind: k, ...(k === 'supplier' ? { category: '' } : {}) })}
            options={KINDS} allLabel="Suppliers + expenses" />
          {v.kind !== 'supplier' && (
            <ListSelect label="Expense for" value={v.category} onChange={(c) => set({ category: c })}
              options={choices.data?.categories ?? []} allLabel="Any expense" />
          )}
          {seesAll && (
            <ListSelect label="Raised by" value={v.by} onChange={(b) => set({ by: b })} allLabel="Anyone"
              options={(choices.data?.people ?? []).map((p) => ({ value: p.id, label: p.team ? `${p.name} (${teamName(p.team)})` : p.name }))} />
          )}
          {showPaidBy && (
            <ListSelect label="Paid by" value={v.method} onChange={(m) => set({ method: m })} options={PAID_BY} allLabel="Any payment method" />
          )}
          <ListDateRange label="Dates" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
            <select aria-label="Which date" value={v.dateOf} onChange={(e) => set({ dateOf: e.target.value })} className={listField}>
              {DATE_OF.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </ListDateRange>
          <ListAmountRange min={v.min} max={v.max} onChange={(min, max) => set({ min, max })} />
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary
            ? (
              <div className="flex flex-wrap items-baseline gap-x-2">
                <ListResultLine count={summary.count} capped={summary.capped} total={summary.total} noun={['payment', 'payments']} formatTotal={rupees} />
                {/* Foreign bills not yet paid have no rupees: counted, left out of the total, and said so. */}
                {!summary.capped && summary.pending ? (
                  <span className="text-xs text-gray-500">+ {summary.pending} foreign bill{summary.pending === 1 ? '' : 's'} not in the total (rupees known when paid)</span>
                ) : null}
              </div>
            )
            : <span />}
          {filtered && <ListClear onClear={() => clear(['status', 'sort', 'dateOf'])} />}
        </div>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load payment requests.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {filtered ? 'No payments match — try fewer words or clear the filters.' : 'Nothing here.'}
        </p>
      )}
      {rows.length > 0 && (
        <ul className={`divide-y overflow-hidden rounded-lg border border-gray-200 bg-white ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900">
                    <span className="truncate">{r.number} · {r.kind === 'supplier' ? `Supplier — ${r.payee.name}` : `${categoryName(r)} — ${r.payee.name}`}</span>
                    {r.kind === 'supplier' && <OrderTypeTag type="procurement" />}
                    {r.partLabel && <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">{r.partLabel}</span>}
                  </p>
                  {r.deal && <DealLine d={r.deal} />}
                  <p className="truncate text-xs text-gray-500">
                    {r.teamLabel} · {r.requestedBy} · {formatDateIST(r.createdAt)}{r.order ? ` · ${r.order.number}` : ''}
                    {r.payment?.reference ? ` · Ref ${r.payment.reference}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-right text-sm font-semibold text-gray-900">
                  {amountText(r)}
                  {r.rupeesPending
                    ? <span className="block text-xs font-normal text-gray-500">₹ when paid</span>
                    : foreignBill(r) && <span className="block text-xs font-normal text-gray-500">{foreignBill(r)}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
      {open && <PaymentRequestDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
