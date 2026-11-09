'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Loader2, Pencil, SlidersHorizontal, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { useListParams } from '@/lib/hooks/useListParams';
import {
  ListAmountRange, ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect, listField,
} from '@/components/panel/ListControls';
import BankTransferDetails, { BANK_TRANSFER_BADGE, type BankTransferStatus } from './BankTransferDetails';

export { transferFileHref, type BankTransferStatus } from './BankTransferDetails';

export type BankTransfer = {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: { name: string; city: string };
  salesPerson: string;
  amount: number;
  reference: string;
  paidOn: string;
  note: string;
  status: BankTransferStatus;
  statusLabel: string;
  recordedBy: string;
  recordedAt: string;
  reviewedBy: string;
  reviewedAt: string | null;
  reviewNote: string;
  files: { id: string; name: string; contentType: string; bytes: number }[];
  can: { confirm: boolean; reject: boolean; edit?: boolean; withdraw?: boolean };
  /** Whoever recorded it may correct it until then (null for admins / once closed). */
  editableUntil?: string | null;
};

type Page = {
  transfers: BankTransfer[];
  nextCursor: string | null;
  /** First page only: how many match and what they add up to (capped at 1,000). */
  summary?: { count: number; total: number | null; capped: boolean };
};
type FilterOptions = { sellers: { id: string; name: string }[] };

const TABS: { value: BankTransferStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'To check' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'all', label: 'All' },
];

const SORTS = [
  { value: 'newest', label: 'Newest recorded first' },
  { value: 'oldest', label: 'Oldest recorded first' },
  { value: 'paid_recent', label: 'Latest paid date first' },
  { value: 'amount_desc', label: 'Amount: high to low' },
  { value: 'amount_asc', label: 'Amount: low to high' },
];
const DATE_OF = [
  { value: 'paid', label: 'Paid on' },
  { value: 'recorded', label: 'Recorded on' },
];
// The filters (not the tab, sort or which-date choice); any of them on → "Clear all".
const FILTER_KEYS = ['q', 'seller', 'from', 'to', 'min', 'max'] as const;

/** A click on the card opens the details, unless it was on a control or selected text. */
const isPlainCardClick = (e: React.MouseEvent) =>
  !(e.target as HTMLElement).closest('a,button,input,textarea,select,label,form')
  && !window.getSelection()?.toString();

function TransferCard({ t, onOpen }: { t: BankTransfer; onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [fix, setFix] = useState({ reference: t.reference, paidOn: String(t.paidOn || '').slice(0, 10), note: t.note || '' });
  // Confirming pays the order, so every order list refreshes with the transfer lists.
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.orders() });

  const confirm = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/confirm`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not confirm this transfer.')),
  });
  const reject = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/reject`, { note: reason.trim() }),
    onSuccess: () => { setError(''); setRejecting(false); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not reject this transfer.')),
  });
  const edit = useMutation({
    mutationFn: () => apiClient.put(`/staff/bank-transfers/${encodeURIComponent(t.id)}`, {
      reference: fix.reference.trim(), paidOn: fix.paidOn, note: fix.note.trim(),
    }),
    onSuccess: () => { setError(''); setEditing(false); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not save the changes.')),
  });
  const withdraw = useMutation({
    mutationFn: () => apiClient.post(`/staff/bank-transfers/${encodeURIComponent(t.id)}/withdraw`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not withdraw this transfer.')),
  });
  const busy = confirm.isPending || reject.isPending || edit.isPending || withdraw.isPending;

  return (
    <li className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
      onClick={(e) => { if (isPlainCardClick(e)) onOpen(t.id); }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {t.orderNumber} · {rupees(t.amount)}
          </p>
          <p className="text-sm text-gray-600">
            {t.customer.name || 'Customer'}{t.customer.city ? ` · ${t.customer.city}` : ''}
            {t.salesPerson ? ` · sold by ${t.salesPerson}` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${BANK_TRANSFER_BADGE[t.status]}`}>{t.statusLabel}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600">
        Paid on {formatDateIST(t.paidOn)} · UTR <span className="font-mono break-all text-gray-900">{t.reference}</span>
      </p>
      <button type="button" onClick={() => onOpen(t.id)}
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
        View full details <ChevronRight className="h-4 w-4" />
      </button>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {t.can.withdraw && !editing && (
        <button type="button" disabled={busy}
          onClick={() => { if (window.confirm(`Withdraw this bank transfer on ${t.orderNumber}? Use this only if it was recorded by mistake — the order becomes unpaid again.`)) withdraw.mutate(); }}
          className="mr-2 mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
          <X className="h-4 w-4" /> Withdraw
        </button>
      )}
      {t.can.edit && !editing && (
        <button type="button" onClick={() => setEditing(true)}
          title={t.editableUntil ? `You can edit until ${formatDateTimeIST(t.editableUntil)}` : undefined}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Pencil className="h-4 w-4" /> Edit
        </button>
      )}
      {editing && (
        <form className="mt-3 space-y-2" aria-label="Edit bank transfer" onSubmit={(e) => { e.preventDefault(); edit.mutate(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">UTR / bank reference</span>
              <input value={fix.reference} onChange={(e) => setFix({ ...fix, reference: e.target.value })} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">Date paid</span>
              <input type="date" value={fix.paidOn} onChange={(e) => setFix({ ...fix, paidOn: e.target.value })} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
          </div>
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-800">Note</span>
            <textarea value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} rows={2} maxLength={500} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {edit.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {t.can.confirm && !rejecting && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy}
            onClick={() => {
              if (window.confirm(`Is ${rupees(t.amount)} with reference ${t.reference} in the company bank account? Confirming marks ${t.orderNumber} as paid and sends it to Procurement.`)) confirm.mutate();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Money is in the bank — confirm
          </button>
          {t.can.reject && (
            <button type="button" disabled={busy} onClick={() => setRejecting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <X className="h-4 w-4" /> Not received — reject
            </button>
          )}
        </div>
      )}

      {rejecting && (
        <div className="mt-4 space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-800">Why? GTM passes this on to the customer.</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} autoFocus
              placeholder="For example: no credit with this UTR in the bank"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => reject.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reject transfer
            </button>
            <button type="button" disabled={busy} onClick={() => { setRejecting(false); setError(''); }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Back
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Bank transfers a salesman recorded for a sales order. Accounts and the admin
 * confirm (the order becomes paid) or reject; the GTM head sees all of them, a
 * GTM lead sees their own. The server decides who sees and may do what — and
 * does the searching and filtering, so every page honours them. The tab, search
 * and filters live in the page address (Back, refresh and a shared link keep
 * them); the page must wrap this in <Suspense>.
 */
export default function BankTransfersList() {
  const { values: v, set, clear } = useListParams({
    status: 'pending', sort: 'newest', dateOf: 'paid', q: '', seller: '', from: '', to: '', min: '', max: '',
  });
  const [openId, setOpenId] = useState<string | null>(null);
  // Phones: the filters fold away behind a button so the list is not pushed off screen.
  const [showFilters, setShowFilters] = useState(false);
  // A tab the page does not offer (an old link) falls back to "To check".
  const status = TABS.some((t) => t.value === v.status) ? v.status : 'pending';
  const sort = SORTS.some((x) => x.value === v.sort) ? v.sort : 'newest';
  const params: Record<string, string> = {
    status,
    ...(sort !== 'newest' ? { sort } : {}),
    ...Object.fromEntries(FILTER_KEYS.filter((k) => v[k]).map((k) => [k, v[k]])),
    ...((v.from || v.to) && v.dateOf !== 'paid' ? { dateOf: v.dateOf } : {}),
  };
  const filtered = FILTER_KEYS.some((k) => v[k]);
  const filtersOn = [v.seller, v.from || v.to, v.min || v.max].filter(Boolean).length;

  const q = useInfiniteQuery({
    queryKey: staffKeys.bankTransfers(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/bank-transfers?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // The "Salesman" choices: only for those who see everyone's (the server sends none to a GTM lead).
  const choices = useQuery({
    queryKey: staffKeys.bankTransferFilterOptions(),
    queryFn: () => apiClient.get<FilterOptions>('/staff/bank-transfers/filter-options'),
    staleTime: 5 * 60_000,
  });
  const sellers = choices.data?.sellers ?? [];
  const rows = q.data?.pages.flatMap((p) => p.transfers) ?? [];
  const summary = q.data?.pages[0]?.summary;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bank transfer status" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button key={tab.value} type="button" role="tab" aria-selected={status === tab.value} onClick={() => set({ status: tab.value })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === tab.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div role="search" aria-label="Search and filter bank transfers" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch
            value={v.q}
            onChange={(text) => set({ q: text.trim() })}
            label="Search bank transfers"
            placeholder="Search order no., customer, city, UTR, amount, salesman, note"
          />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={SORTS} />
          <button type="button" onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters} aria-controls="bank-transfer-filters"
            className={`${listField} inline-flex items-center gap-1.5 sm:hidden`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{filtersOn ? ` · ${filtersOn} on` : ''}
          </button>
        </div>
        <div id="bank-transfer-filters" className={`${showFilters ? 'flex' : 'hidden'} flex-wrap items-center gap-2 sm:flex`}>
          {sellers.length > 0 && (
            <ListSelect label="Salesman" value={v.seller} onChange={(x) => set({ seller: x })} allLabel="Any salesman"
              options={sellers.map((p) => ({ value: p.id, label: p.name }))} />
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
            ? <ListResultLine count={summary.count} capped={summary.capped} total={summary.total} noun={['bank transfer', 'bank transfers']} formatTotal={rupees} />
            : <span />}
          {filtered && <ListClear onClear={() => clear(['status', 'sort', 'dateOf'])} />}
        </div>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load bank transfers.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {filtered
            ? 'No bank transfers match — try fewer words or clear the filters.'
            : status === 'pending' ? 'Nothing to check. New bank transfers appear here.' : 'No bank transfers here yet.'}
        </p>
      )}

      <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        {rows.map((t) => <TransferCard key={t.id} t={t} onOpen={setOpenId} />)}
      </ul>

      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}

      {openId && <BankTransferDetails id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
