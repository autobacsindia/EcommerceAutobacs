'use client';

import { useState } from 'react';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { delayKeys } from './keys';
import DelayList, { SummaryTiles } from './DelayList';
import {
  type DelayControl, type DelayFilters, type DelayPersonRow, type DelayRanking as Ranking,
  TEAM_LABELS, filterParams, officeDuration,
} from './types';

/*
  Who is holding the most late work — one row per owner, most late steps first,
  then most office time late. A head's list is their own team (the server
  enforces it); the admin sees everyone and can narrow to a team. Click a person
  to see their list with the same actions they have.
*/

const field = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const RANKED_TEAMS = ['procurement', 'operations', 'sales', 'accounts', 'marketing', 'developer', 'hr'];

export function DelayFiltersBar({ value, onChange, showTeam }: { value: DelayFilters; onChange: (f: DelayFilters) => void; showTeam: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {showTeam && (
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Team
          <select aria-label="Team" className={field} value={value.team || ''} onChange={(e) => onChange({ ...value, team: e.target.value })}>
            <option value="">All teams</option>
            {RANKED_TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABELS[t]}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Late because
        <select aria-label="Late because" className={field} value={value.control || ''} onChange={(e) => onChange({ ...value, control: e.target.value as DelayControl | '' })}>
          <option value="">Everything</option>
          <option value="inside">Inside our control (incl. no reason)</option>
          <option value="outside">Outside our control</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Due from
        <input type="date" aria-label="Due from" className={field} value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Due to
        <input type="date" aria-label="Due to" className={field} value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </label>
      {(value.team || value.control || value.from || value.to) && (
        <button type="button" onClick={() => onChange({})} className="pb-2 text-xs font-medium text-blue-700 hover:underline">Clear</button>
      )}
    </div>
  );
}

function PersonRow({ p, rank, onOpen }: { p: DelayPersonRow; rank: number; onOpen: (p: DelayPersonRow) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(p)}
        disabled={!p.id}
        className="flex w-full flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow disabled:cursor-default disabled:hover:border-gray-200 sm:flex-row sm:items-center"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${p.late ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{rank}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-gray-900">{p.name}</span>
            <span className="block text-xs text-gray-500">{p.teamLabel}{!p.id ? ' · no one to own it — team head missing' : ''}</span>
          </span>
        </span>
        <span className="grid grid-cols-4 gap-3 text-center text-xs sm:w-[420px]">
          <span><b className="block text-base text-red-700">{p.late}</b>late</span>
          <span><b className="block text-base text-amber-700">{p.today}</b>today</span>
          <span><b className="block text-base text-gray-900">{officeDuration(p.minutesLate)}</b>late in all</span>
          <span><b className="block text-base text-gray-900">{p.noReason}</b>no reason</span>
        </span>
      </button>
    </li>
  );
}

export default function DelayRanking({ mode = 'admin' }: { mode?: 'team' | 'admin' }) {
  const [filters, setFilters] = useState<DelayFilters>({});
  const [person, setPerson] = useState<DelayPersonRow | null>(null);
  const params = filterParams(mode === 'admin' ? filters : { ...filters, team: '' });
  const q = useInfiniteQuery({
    queryKey: delayKeys.ranking(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Ranking>(`/staff/delays${qs.size ? `?${qs}` : ''}`);
    },
    placeholderData: keepPreviousData,
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 120_000,
    enabled: !person,
  });

  if (person?.id) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setPerson(null)} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to everyone
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{person.name}</h2>
          <p className="text-sm text-gray-500">{person.teamLabel}</p>
        </div>
        <DelayList personId={person.id} mode={mode} filters={filters} />
      </div>
    );
  }

  const first = q.data?.pages[0];
  const people = q.data?.pages.flatMap((p) => p.people) ?? [];
  return (
    <div className="space-y-5">
      <DelayFiltersBar value={filters} onChange={setFilters} showTeam={mode === 'admin'} />
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the delays.')}</p>}
      {first && (
        <>
          <SummaryTiles s={first.totals} />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {first.totals.outside} late for reasons outside our control · as of {formatDateTimeIST(first.asOf)}
              {first.truncated ? ' · list capped' : ''}
            </span>
            <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className="inline-flex items-center gap-1.5 font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {people.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nobody has anything late, due today or pending.</p>
          ) : (
            <ol className={`space-y-2 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
              {people.map((p, i) => <PersonRow key={p.key} p={p} rank={i + 1} onOpen={setPerson} />)}
            </ol>
          )}
          {q.hasNextPage && (
            <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}
