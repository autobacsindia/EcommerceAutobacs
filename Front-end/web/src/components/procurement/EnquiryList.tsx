'use client';

import Link from 'next/link';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Calculator, Loader2, Plus } from 'lucide-react';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListResultLine, ListSearch } from '@/components/panel/ListControls';
import { formatDateIST } from '@/lib/datetime';
import { enquiryKeys, errorMessage, listEnquiries, unitLabel } from './enquiry';
import { STATUS_CLASS, STATUS_LABEL } from './EnquiryDetail';

const TABS = [['open', 'Open'], ['sent', 'Waiting'], ['replied', 'Replies in'], ['closed', 'Closed'], ['all', 'All']] as const;

/** Procurement's enquiries, newest first; the server searches, filters and pages (keyset). */
export default function EnquiryList({ base, calculatorHref }: { base: string; calculatorHref: string }) {
  const { values: v, set, clear } = useListParams({ q: '', status: 'open' });
  const status = TABS.some(([k]) => k === v.status) ? v.status : 'open';
  const params: Record<string, string> = { ...(status !== 'all' ? { status } : {}), ...(v.q ? { q: v.q } : {}) };
  const query = useInfiniteQuery({
    queryKey: enquiryKeys.list(params),
    queryFn: ({ pageParam }) => listEnquiries({ ...params, ...(pageParam ? { after: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextAfter || undefined,
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.pages.flatMap((p) => p.enquiries) ?? [];
  const summary = query.data?.pages[0]?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Enquiry status" className="flex flex-wrap gap-2">
          {TABS.map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => set({ status: k })}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === k ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={calculatorHref} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Calculator className="h-4 w-4" /> Price calculator
          </Link>
          <Link href={`${base}/new`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New enquiry
          </Link>
        </div>
      </div>

      <div role="search" aria-label="Search enquiries" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search enquiries" placeholder="Search ref, item, brand, part no. or supplier" />
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary ? <ListResultLine count={summary.count} capped={summary.capped} noun={['enquiry', 'enquiries']} /> : <span />}
          {v.q && <ListClear onClear={() => clear(['status'])} />}
        </div>
      </div>

      {query.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {query.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(query.error, 'Could not load enquiries.')} <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button>
        </p>
      )}
      {query.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {v.q ? 'No enquiry matches — try fewer words.' : 'No enquiries here yet. Press “New enquiry” to ask suppliers for a price.'}
        </p>
      )}
      <ul className={`space-y-2 ${query.isPlaceholderData ? 'opacity-60' : ''}`}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`${base}/${r.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gray-900">{r.ref}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <p className="mt-1 truncate text-sm text-gray-800">
                {r.items.map((i) => `${i.name} × ${i.qty} ${unitLabel(i.qty, i.unit)}`).join(', ')}
                {r.itemCount > r.items.length && ` +${r.itemCount - r.items.length} more`}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {formatDateIST(r.createdAt)} · {r.createdByName || '—'} · {r.supplierCount} supplier{r.supplierCount === 1 ? '' : 's'}
                {' · '}{r.sentCount} sent · {r.repliedCount} replied
                {r.neededBy && ` · needed by ${formatDateIST(r.neededBy)}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
