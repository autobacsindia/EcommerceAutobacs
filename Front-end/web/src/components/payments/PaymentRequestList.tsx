'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, listRequests, paymentKeys, rupees, STATUS_TONE } from './api';
import PaymentRequestDetail from './PaymentRequestDetail';
import OrderTypeTag from '@/components/orders/OrderTypeTag';

export type ListFilter = { value: string; label: string };

/**
 * Payment requests as a list with status filters; a row opens its detail.
 * What appears is decided by the server: a team sees its own, admin and
 * accounts see every team (and may filter by one).
 */
export default function PaymentRequestList({
  filters,
  initial,
  teams,
}: {
  filters: ListFilter[];
  initial: string;
  /** Admin / accounts: a team filter. */
  teams?: { value: string; label: string }[];
}) {
  const [status, setStatus] = useState(initial);
  const [team, setTeam] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const params: Record<string, string> = { ...(status !== 'all' ? { status } : {}), ...(team ? { team } : {}) };
  const q = useInfiniteQuery({
    queryKey: paymentKeys.list(params),
    queryFn: ({ pageParam }) => listRequests(params, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.requests);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${status === f.value ? 'border-blue-600 bg-blue-50 font-medium text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
        {teams && (
          <select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load payment requests.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing here.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border border-gray-200 bg-white">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900">
                    <span className="truncate">{r.number} · {r.kind === 'supplier' ? `Supplier — ${r.payee.name}` : `${r.category} — ${r.payee.name}`}</span>
                    {r.kind === 'supplier' && <OrderTypeTag type="procurement" />}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {r.teamLabel} · {r.requestedBy} · {formatDateIST(r.createdAt)}{r.order ? ` · ${r.order.number}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-gray-900">{rupees(r.amount)}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
      {open && <PaymentRequestDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
