'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListResultLine, ListSearch, ListSelect } from '@/components/panel/ListControls';
import { errorMessage } from '../api';
import SubscriptionDetail from './SubscriptionDetail';
import SubscriptionForm from './SubscriptionForm';
import {
  approxText, billText, CYCLE_TONE, dayText, dueText, estimateText, getMonthlyTotals, listSubscriptions, monthText, payText, perText,
  rupeeText, STATUS_TONE, subscriptionKeys,
} from './api';

/**
 * Paid bills per month, in rupees — the last three months. Accounts / admin see
 * every team (or the one filtered); a team sees its own.
 */
function MonthlyTotals({ team }: { team: string }) {
  const q = useQuery({ queryKey: subscriptionKeys.monthly(team), queryFn: () => getMonthlyTotals(team) });
  const months = (q.data?.months ?? []).slice(0, 3);
  if (!months.length) return null;
  return (
    <section aria-label="Paid per month" className="flex flex-wrap gap-2">
      {months.map((m) => (
        <div key={m.month} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <p className="text-xs text-gray-500">Paid · {monthText(`${m.month}-01`)}</p>
          <p className="font-semibold text-gray-900">{rupeeText(m.rupees)}</p>
          <p className="text-xs text-gray-500">{m.bills} bill{m.bills === 1 ? '' : 's'}{m.unpriced ? ` · ${m.unpriced} without rupees yet` : ''}</p>
        </div>
      ))}
    </section>
  );
}

/** The quick filters. "Due in 7 days" and "Overdue" are about the date; the rest about the check. */
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'week', label: 'Due in 7 days' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Waiting for check' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'verified', label: 'Verified' },
] as const;
const DUE_VIEWS = new Set(['week', 'overdue']);

/**
 * Payments → Subscriptions & dues. Soonest due first. A team sees its own items;
 * accounts and the admin see every team's (`teams` — the team filter). Any staff
 * member may add one; the server decides who may edit, delete, verify or reject.
 */
export default function SubscriptionList({ teams, intro }: {
  /** Accounts / admin: the team filter. */
  teams?: { value: string; label: string }[];
  intro?: string;
}) {
  const qc = useQueryClient();
  const { values: v, set, clear } = useListParams({ show: 'all', team: '', q: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  const view = VIEWS.some((x) => x.value === v.show) ? v.show : 'all';
  const params: Record<string, string> = {
    ...(DUE_VIEWS.has(view) ? { due: view } : view !== 'all' ? { status: view } : {}),
    ...(teams && v.team ? { team: v.team } : {}),
    ...(v.q ? { q: v.q } : {}),
  };
  const filtered = Boolean(v.q || v.team);

  const q = useInfiniteQuery({
    queryKey: subscriptionKeys.list(params),
    queryFn: ({ pageParam }) => listSubscriptions(params, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const summary = q.data?.pages[0]?.summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-600">
          {intro ?? 'Every tool, subscription and bill your team pays for, and when it is next due. Accounts checks each one.'}
        </p>
        {!adding && (
          <button type="button" onClick={() => { setAdding(true); setNotice(''); }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      <MonthlyTotals team={teams ? v.team : ''} />

      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {adding && (
        <SubscriptionForm
          onCancel={() => setAdding(false)}
          onDone={(s) => {
            setAdding(false);
            setNotice(`${s.name} (${s.number}) added. Accounts will check it — you will see it move here and in team chat.`);
            qc.invalidateQueries({ queryKey: [...subscriptionKeys.all, 'list'] });
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((f) => (
          <button key={f.value} type="button" aria-pressed={view === f.value} onClick={() => set({ show: f.value })}
            className={`rounded-lg border px-3 py-1.5 text-sm ${view === f.value ? 'border-blue-600 bg-blue-50 font-medium text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div role="search" aria-label="Search subscriptions" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search subscriptions" placeholder="Search name, what it's for, SD number, who added it" />
          {teams && <ListSelect label="Team" value={v.team} onChange={(t) => set({ team: t })} options={teams} allLabel="All teams" />}
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary ? <ListResultLine count={summary.count} capped={summary.capped} noun={['item', 'items']} /> : <span />}
          {filtered && <ListClear onClear={() => clear(['show'])} />}
        </div>
      </div>

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load the list.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {filtered || view !== 'all' ? 'Nothing matches — try another filter.' : 'No subscriptions yet. Add your first one with “Add”.'}
        </p>
      )}
      {rows.length > 0 && (
        <ul className={`divide-y overflow-hidden rounded-lg border border-gray-200 bg-white ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 ${s.overdue && s.status === 'verified' && (!s.current || s.current.state === 'rejected') ? 'border-l-4 border-red-500 bg-red-50/40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{s.name} <span className="font-normal text-gray-500">· {s.number}</span></p>
                  <p className="truncate text-xs text-gray-500">{s.teamLabel} · {s.kindLabel} · {payText(s.payment)}</p>
                  <p className={`text-xs font-medium ${s.overdue ? 'text-red-700' : s.dueInDays <= 7 ? 'text-amber-700' : 'text-gray-600'}`}>
                    {dayText(s.dueDate)} · {dueText(s)}
                  </p>
                </div>
                <span className="shrink-0 text-right text-sm font-semibold text-gray-900">
                  {billText(s)}{perText(s.kind)}{estimateText(s)}
                  {approxText(s.approxInr) && <span className="block text-xs font-normal text-gray-500">{approxText(s.approxInr)}</span>}
                </span>
                {s.current ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${CYCLE_TONE[s.current.state]}`}>
                    {s.current.state === 'rejected' ? 'Payment rejected' : s.current.stateLabel}
                  </span>
                ) : s.can.markPaid ? (
                  <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">Mark paid</span>
                ) : (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status]}`}>{s.statusLabel}</span>
                )}
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
      {open && <SubscriptionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
