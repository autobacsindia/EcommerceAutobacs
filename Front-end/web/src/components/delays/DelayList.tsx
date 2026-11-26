'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Clock, ExternalLink, Loader2, MessageSquareWarning, PackageX, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { OVERDUE_REASONS, MAX_OVERDUE_NOTE } from '@/components/staff/work/ParcelOverdueReason';
import WorkOrderPanel from '@/components/staff/work/WorkOrderPanel';
import { delayKeys } from './keys';
import {
  type DelayBucket, type DelayFilters, type DelayItem, type DelayPage,
  filterParams, formatDay, officeDuration, teamLabel,
} from './types';

/*
  One person's delays: late → due today → pending, most late first (the server's
  order; pages are keyset). Every action reuses an endpoint the panel already
  has — the parcel reason (PUT …/overdue-reason), the order's own work panel,
  and the task's PATCH — so nothing here can change state any other way.
*/

type Mode = 'team' | 'admin';

const SECTION: Record<DelayBucket, { title: string; tone: string; empty: string }> = {
  late: { title: 'Late', tone: 'text-red-700', empty: '' },
  today: { title: 'Due today', tone: 'text-amber-700', empty: '' },
  pending: { title: 'Pending', tone: 'text-gray-700', empty: '' },
};

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const field = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

function ReasonForm({ item, onDone }: { item: DelayItem; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => apiClient.put(
      `/staff/work/orders/${item.order!.id}/parcels/${item.shipmentId}/overdue-reason`,
      { code, note: note.trim(), expectedDate: item.etaDay },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: delayKeys.all });
      onDone();
    },
  });
  const needsNote = code === 'other' && !note.trim();
  return (
    <form
      className="mt-3 flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-end"
      onSubmit={(e) => { e.preventDefault(); if (code && !needsNote) save.mutate(); }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
        Reason
        <select aria-label="Reason" className={field} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Pick one…</option>
          {OVERDUE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-gray-700">
        Note {code === 'other' ? '(required)' : '(optional)'}
        <input aria-label="Note" className={field} value={note} maxLength={MAX_OVERDUE_NOTE} onChange={(e) => setNote(e.target.value)} placeholder="What happened, what's next" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!code || needsNote || save.isPending} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save reason
        </button>
        <button type="button" onClick={onDone} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>Cancel</button>
      </div>
      {save.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(save.error, 'Could not save the reason.')}</p>}
    </form>
  );
}

function TaskDone({ item }: { item: DelayItem }) {
  const queryClient = useQueryClient();
  const done = useMutation({
    mutationFn: () => apiClient.patch(`/staff/tasks/${item.task!.id}`, { rev: item.task!.rev, status: 'done' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: delayKeys.all }),
  });
  return (
    <>
      <button type="button" onClick={() => done.mutate()} disabled={done.isPending} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
        {done.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Mark done
      </button>
      {done.isError && <span role="alert" className="text-xs text-red-700">{errorMessage(done.error, 'Could not mark it done — open the task.')}</span>}
    </>
  );
}

function whenText(item: DelayItem): string {
  if (item.bucket === 'late') return `${officeDuration(item.minutesLate)} late (office time)`;
  if (item.bucket === 'today') return `Due today · ${formatDateTimeIST(item.dueAt).split(', ').pop()}`;
  return `Due ${formatDateTimeIST(item.dueAt)}`;
}

function Row({ item, mode, showOwner }: { item: DelayItem; mode: Mode; showOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const base = mode === 'admin' ? '/admin' : '/team';
  const late = item.bucket === 'late';
  const parcelOverdue = item.kind === 'parcel' && !!item.etaDay && !item.nextFollowUp;
  return (
    <li className={`rounded-xl border bg-white p-4 shadow-sm ${late ? 'border-red-200' : item.bucket === 'today' ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{item.stageLabel}</span>
            {item.subtitle && <span>{item.subtitle}</span>}
            {showOwner && <span>· {item.owner.name}</span>}
            {item.owner.via === 'head' && <span className="text-gray-400">· with the team head (nobody on the team has moved it)</span>}
            {item.team && <span>· {teamLabel(item.team)} queue</span>}
          </p>
        </div>
        <p className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${late ? 'text-red-700' : item.bucket === 'today' ? 'text-amber-700' : 'text-gray-600'}`}>
          <Clock className="h-3.5 w-3.5" /> {whenText(item)}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {item.reason ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${item.reason.control === 'outside' ? 'bg-sky-50 text-sky-800' : 'bg-gray-100 text-gray-700'}`}>
            {item.reason.label}{item.reason.note ? ` — ${item.reason.note}` : ''} · {item.reason.control === 'outside' ? 'outside our control' : 'inside our control'}
          </span>
        ) : late ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700"><AlertTriangle className="h-3 w-3" /> No reason yet</span>
        ) : null}
        {item.flags.noEta && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800"><PackageX className="h-3 w-3" /> No expected delivery date</span>
        )}
        {item.nextFollowUp && (
          <span className="inline-flex items-center gap-1 text-gray-500"><CalendarClock className="h-3 w-3" /> Next follow-up {formatDay(item.nextFollowUp)}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.kind === 'parcel' && parcelOverdue && !explaining && (
          <button type="button" onClick={() => setExplaining(true)} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>
            <MessageSquareWarning className="h-3.5 w-3.5" /> {item.reason ? 'Change reason' : 'Give reason'}
          </button>
        )}
        {item.order && (mode === 'admin' ? (
          <Link href={`/admin/orders/${item.order.id}`} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open order
          </Link>
        ) : (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? 'Close order' : item.flags.noEta ? 'Open order · set date' : 'Open order · update'}
          </button>
        ))}
        {item.task && <TaskDone item={item} />}
        {item.task && (
          <Link href={`${base}/tasks/${item.task.id}`} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open task
          </Link>
        )}
        {item.project && (
          <Link href={`${base}/tasks?view=project&project=${encodeURIComponent(item.project.id)}`} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open project
          </Link>
        )}
      </div>
      {explaining && <ReasonForm item={item} onDone={() => setExplaining(false)} />}
      {open && item.order && <div className="mt-3 border-t border-gray-100 pt-3"><WorkOrderPanel orderId={item.order.id} /></div>}
    </li>
  );
}

export function SummaryTiles({ s }: { s: DelayPage['summary'] }) {
  const tile = 'rounded-xl border bg-white px-4 py-3';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className={`${tile} border-red-200`}><p className="text-xs text-gray-500">Late</p><p className="text-2xl font-bold text-red-700">{s.late}</p></div>
      <div className={`${tile} border-amber-200`}><p className="text-xs text-gray-500">Due today</p><p className="text-2xl font-bold text-amber-700">{s.today}</p></div>
      <div className={`${tile} border-gray-200`}><p className="text-xs text-gray-500">Pending</p><p className="text-2xl font-bold text-gray-900">{s.pending}</p></div>
      <div className={`${tile} border-gray-200`}><p className="text-xs text-gray-500">Late, no reason</p><p className="text-2xl font-bold text-gray-900">{s.noReason}</p></div>
    </div>
  );
}

/**
 * `personId` absent → the caller's own list (/staff/delays/me); present → that
 * person's (the server allows self, their team head and the admin only).
 */
export default function DelayList({ personId, mode = 'team', filters = {}, showOwner = false }: {
  personId?: string; mode?: Mode; filters?: DelayFilters; showOwner?: boolean;
}) {
  const params = filterParams({ control: filters.control, from: filters.from, to: filters.to });
  const q = useInfiniteQuery({
    queryKey: personId ? delayKeys.person(personId, params) : delayKeys.mine(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      const path = personId ? `/staff/delays/people/${encodeURIComponent(personId)}` : '/staff/delays/me';
      return apiClient.get<DelayPage>(`${path}${qs.size ? `?${qs}` : ''}`);
    },
    placeholderData: keepPreviousData,
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 120_000,
  });

  if (q.isPending) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the delays.')}</p>;

  const first = q.data.pages[0];
  const items = q.data.pages.flatMap((p) => p.items);
  const groups = (['late', 'today', 'pending'] as DelayBucket[]).map((b) => ({ b, rows: items.filter((i) => i.bucket === b) })).filter((g) => g.rows.length);

  return (
    <div className="space-y-5">
      <SummaryTiles s={first.summary} />
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Live — as of {formatDateTimeIST(first.asOf)}{first.truncated ? ' · list capped, the oldest work may be missing' : ''}</span>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="inline-flex items-center gap-1.5 font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Nothing late, due today or pending. All clear.
        </p>
      ) : groups.map(({ b, rows }) => (
        <section key={b} aria-label={SECTION[b].title}>
          <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${SECTION[b].tone}`}>{SECTION[b].title} · {rows.length}{q.hasNextPage ? '+' : ''}</h2>
          <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
            {rows.map((i) => <Row key={i.key} item={i} mode={mode} showOwner={showOwner} />)}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          {q.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Show more
        </button>
      )}
    </div>
  );
}
