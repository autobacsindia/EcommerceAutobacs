'use client';

import { useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListSearch, ListSelect } from '@/components/panel/ListControls';
import MetaLeadCard from './MetaLeadCard';
import MetaLeadPanel from './MetaLeadPanel';
import MetaLeadActivityView from './MetaLeadActivity';
import { FOLLOW_UP_OPTIONS } from './followUpStatus';
import type { MetaLead, MetaLeadPage, MetaLeadPeople, MetaLeadYou } from './metaLeadTypes';

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Unclaimed' },
  { value: 'mine', label: 'Mine' },
] as const;
const FOLLOW_UP_FILTERS = [
  ...FOLLOW_UP_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  { value: 'none', label: 'No follow-up yet' },
];
const DUE_FILTERS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today (and overdue)' },
];
const NOBODY: MetaLeadYou = { userId: '', canEdit: false, canFollowUp: false, canManage: false, canReview: false };

const EMPTY_TEXT: Record<string, string> = {
  mine: 'You are not following up on any lead yet. Pick one from All or Unclaimed.',
  free: 'Every lead has someone following up.',
  all: 'No Meta leads yet.',
};

/** Enquiries from the sales lead sheet, and the team's follow-ups on them. The server decides who may do what; filters live in the address. Wrap in <Suspense>. */
export default function MetaLeadsList() {
  const { values: v, set, clear } = useListParams({ view: 'all', owner: '', followUp: '', due: '', tab: '', q: '', show: '' });
  const [details, setDetails] = useState<MetaLead | null>(null);
  const view = v.owner ? 'all' : (VIEWS.some((x) => x.value === v.view) ? v.view : 'all');
  const params: Record<string, string> = {
    ...(view !== 'all' ? { view } : {}),
    ...(v.owner ? { owner: v.owner } : {}),
    ...(v.followUp ? { followUp: v.followUp } : {}),
    ...(v.due ? { due: v.due } : {}),
    ...(v.tab ? { tab: v.tab } : {}),
    ...(v.q ? { q: v.q } : {}),
  };
  const filtered = !!(v.owner || v.followUp || v.due || v.tab || v.q);

  const q = useInfiniteQuery({
    queryKey: staffKeys.metaLeadList(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<MetaLeadPage>(`/staff/meta-leads?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const people = useQuery({
    queryKey: staffKeys.metaLeadPeople(),
    queryFn: () => apiClient.get<MetaLeadPeople>('/staff/meta-leads/people'),
    staleTime: 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.leads) ?? [];
  const first = q.data?.pages[0];
  const you = first?.you ?? NOBODY;
  const sync = first?.sync;
  const wb = sync?.writeBack;
  const showActivity = v.show === 'activity' && you.canReview;
  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-medium ${on ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Which leads" className="flex flex-wrap gap-2">
        {VIEWS.map((tab) => (
          <button key={tab.value} type="button" role="tab" aria-selected={!showActivity && view === tab.value && !v.owner} onClick={() => set({ view: tab.value, owner: '', show: '' })}
            className={pill(!showActivity && view === tab.value && !v.owner)}>
            {tab.label}
          </button>
        ))}
        {you.canReview && (
          <button type="button" role="tab" aria-selected={showActivity} onClick={() => set({ show: 'activity' })} className={pill(showActivity)}>
            Team activity
          </button>
        )}
      </div>

      {wb?.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{wb.error} {wb.pending > 0 && `${wb.pending} change${wb.pending === 1 ? ' is' : 's are'} waiting and will be written automatically once this is fixed.`}</p>
            {wb.robotEmail && <p className="mt-1">In Google Sheets, click Share and give <span className="break-all font-mono font-semibold">{wb.robotEmail}</span> Editor access.</p>}
          </div>
        </div>
      )}
      {wb && !wb.error && wb.notInSheet > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {wb.notInSheet} lead{wb.notInSheet === 1 ? ' was' : 's were'} not found in the sheet, so their changes stay here only. They are marked &quot;Not found in the sheet&quot;.
        </p>
      )}

      {showActivity ? <MetaLeadActivityView /> : (<>

      <div role="search" aria-label="Search and filter Meta leads" className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search Meta leads" placeholder="Search name, phone, product or status" />
        <ListSelect label="Person" value={v.owner} onChange={(x) => set({ owner: x })} allLabel="Anyone"
          options={(people.data?.people ?? []).map((p) => ({ value: p.userId, label: p.name }))} />
        <ListSelect label="Follow-up" value={v.followUp} onChange={(x) => set({ followUp: x })} allLabel="Any follow-up" options={FOLLOW_UP_FILTERS} />
        <ListSelect label="Due" value={v.due} onChange={(x) => set({ due: x })} allLabel="Any deadline" options={DUE_FILTERS} />
        <ListSelect label="Tab" value={v.tab} onChange={(x) => set({ tab: x })} allLabel="All tabs"
          options={(first?.tabs ?? []).map((t) => ({ value: t.name, label: `${t.name} (${t.rows})` }))} />
        {filtered && <ListClear onClear={() => clear(['view', 'show'])} />}
      </div>

      {sync && !sync.connected && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">The sales lead sheet is not connected yet.</p>}
      {sync?.connected && sync.stale && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Could not update from the sheet since {formatDateTimeIST(sync.lastSuccessAt)}. New leads may be missing here — check the sheet until this clears.
        </p>
      )}
      {sync && sync.skippedTabs.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Could not read these sheet tabs, so their rows are not here: {sync.skippedTabs.join(', ')}. Check their column headings.
        </p>
      )}
      {sync && sync.columnsMoved.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> A column was inserted or moved on: {sync.columnsMoved.join(', ')}. Sales person and Follow-up text from the sheet may be in the wrong place. Your follow-ups here are safe.
        </p>
      )}
      {sync?.connected && !sync.stale && (
        <p className="text-xs text-gray-500">
          Updated from the sheet at {formatDateTimeIST(sync.lastSuccessAt)}
          {wb && !wb.error && (wb.pending > 0 ? ` · ${wb.pending} change${wb.pending === 1 ? '' : 's'} on the way to the sheet` : wb.lastSuccessAt ? ` · Written to the sheet at ${formatDateTimeIST(wb.lastSuccessAt)}` : '')}
        </p>
      )}

      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load Meta leads.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{filtered ? 'No leads match — try fewer words or clear the filters.' : EMPTY_TEXT[view]}</p>
      )}

      <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        {rows.map((l) => <MetaLeadCard key={l.id} lead={l} you={you} members={people.data?.members} onDetails={() => setDetails(l)} />)}
      </ul>

      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}

      </>)}

      {details && <MetaLeadPanel key={details.id} lead={details} onClose={() => setDetails(null)} />}
    </div>
  );
}
